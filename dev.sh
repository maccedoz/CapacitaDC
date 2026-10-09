#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

cd "$(dirname "${BASH_SOURCE[0]}")"
DEV_FRONTEND_PORT="${PORT:-3000}"
DEV_URL="http://localhost:${DEV_FRONTEND_PORT}"
BACKEND_PID=""
FRONTEND_PID=""

# Instalar dependências ou iniciar um servidor pode falhar depois de outro subir.
cleanup() {
    local status=$?
    trap - INT TERM EXIT
    if [ -n "$BACKEND_PID" ] || [ -n "$FRONTEND_PID" ]; then
        echo -e "\n🛑 Encerrando servidores backend e frontend..."
        [ -z "$FRONTEND_PID" ] || kill "$FRONTEND_PID" 2>/dev/null || true
        [ -z "$BACKEND_PID" ] || kill "$BACKEND_PID" 2>/dev/null || true
    fi
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "🚀 Iniciando ambiente de desenvolvimento do Capacita DC..."

# 1. Iniciar banco de dados no Docker
if docker compose version &> /dev/null; then
    DOCKER_COMPOSE="docker compose"
elif command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE="docker-compose"
else
    echo "❌ Erro: docker compose ou docker-compose não está instalado."
    exit 1
fi

echo "📦 Iniciando contêiner do PostgreSQL..."
$DOCKER_COMPOSE up -d database

# 2. Aguardar o banco estar pronto para receber conexões
echo "⏳ Aguardando PostgreSQL iniciar na porta 5432..."
python3 -c "
import socket
import time
start_time = time.time()
while True:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(1)
        s.connect(('127.0.0.1', 5432))
        s.close()
        print('✅ PostgreSQL está pronto!')
        break
    except Exception:
        if time.time() - start_time > 30:
            print('❌ Tempo esgotado esperando o PostgreSQL.')
            exit(1)
        time.sleep(1)
"

# 3. Configurar ambiente virtual do Python para o Backend
cd backend
if [ ! -d ".venv" ]; then
    echo "🐍 Criando ambiente virtual Python (.venv)..."
    python3 -m venv .venv
fi

echo "📥 Instalando dependências do backend..."
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

# 4. Criar tabelas e popular dados iniciais (seed)
echo "🌱 Inicializando e populando o banco de dados..."
SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-admin123}" .venv/bin/python -m app.seed

# 5. Iniciar o servidor Backend (uvicorn)
echo "⚡ Iniciando servidor Backend FastAPI na porta 8000..."
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload &
BACKEND_PID=$!
cd ..

# 6. Configurar e iniciar Frontend
echo "📦 Instalando dependências do frontend..."
cd frontend
# O projeto usa npm. Manter um único gerenciador evita travas de dependência
# concorrentes, que fazem o Next avisar sobre múltiplos lockfiles no build.
npm install
echo "⚡ Iniciando servidor Frontend Next.js na porta ${DEV_FRONTEND_PORT}..."
# Porta explícita: se estiver ocupada, o Next falha em vez de trocar a URL.
API_BACKEND_URL=http://127.0.0.1:8000 npm run dev -- --port "$DEV_FRONTEND_PORT" &
FRONTEND_PID=$!
cd ..

# 7. Abrir o navegador automaticamente
echo "🌐 Aguardando a API e a página de login responderem..."
python3 - "$DEV_URL" "$BACKEND_PID" "$FRONTEND_PID" <<'PY'
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser

url, *pids = sys.argv[1:]
# Requisições locais não devem passar pelo proxy do terminal.
http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
deadline = time.monotonic() + 120
pending = ['http://127.0.0.1:8000/openapi.json', f'{url}/login']
while pending:
    for pid in pids:
        try:
            os.kill(int(pid), 0)
        except ProcessLookupError:
            sys.exit('❌ Um servidor encerrou antes de ficar pronto. Confira o erro acima (incluindo porta ocupada).')
    if time.monotonic() >= deadline:
        sys.exit(f'❌ Tempo esgotado aguardando {pending[0]}. Confira os logs acima.')
    try:
        with http.open(pending[0], timeout=3) as response:
            if response.status == 200:
                pending.pop(0)
    except (urllib.error.URLError, TimeoutError, OSError):
        pass
    if pending:
        time.sleep(1)

# Preferir o navegador padrão do desktop. Python pode escolher um navegador
# diferente ou retornar False sem erro quando não consegue abrir uma janela.
opened = False
commands = []
if os.environ.get('WSL_DISTRO_NAME') and shutil.which('wslview'):
    commands.append(['wslview', url])
if sys.platform == 'darwin':
    commands.append(['open', url])
elif os.environ.get('DISPLAY') or os.environ.get('WAYLAND_DISPLAY'):
    if shutil.which('xdg-open'):
        commands.append(['xdg-open', url])
    if shutil.which('gio'):
        commands.append(['gio', 'open', url])
for command in commands:
    try:
        result = subprocess.run(command, timeout=10, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode == 0:
            opened = True
            break
    except (OSError, subprocess.TimeoutExpired):
        pass
if not opened:
    try:
        opened = webbrowser.open(url)
    except webbrowser.Error:
        pass
if opened:
    print(f'🌐 Abertura solicitada ao navegador: {url}')
else:
    print(f'⚠️ Não foi possível abrir o navegador automaticamente. Abra: {url}')
PY

echo "✨ Sistema disponível em ${DEV_URL}"
echo "Pressione Ctrl+C para encerrar o ambiente."

# Manter o script rodando para monitorar os logs dos servidores em segundo plano
wait
