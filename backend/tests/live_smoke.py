"""Live smoke test: exercises the API through the running Next.js proxy.

It needs both servers up and a disposable database, so it stays out of unittest
discovery (which collects `test*.py`).

    DATABASE_URL="sqlite:///$PWD/smoke.db" JWT_SECRET_KEY=smoke-only \
      backend/.venv/bin/python -m uvicorn app.main:app --port 8021 --app-dir backend &
    (cd frontend && API_BACKEND_URL=http://127.0.0.1:8021 npm run dev -- -p 3017 &)
    backend/.venv/bin/python backend/tests/live_smoke.py ./smoke.db http://127.0.0.1:3017

The database path is used to create the test accounts, since there is no public
registration route.

check_upload() writes to real private Vercel Blob storage, so the uvicorn process
also needs BLOB_READ_WRITE_TOKEN (or to run where OIDC is available) set in its
environment.
"""

import io
import json as jsonlib
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import uuid

from passlib.context import CryptContext

PASSWORD_HASH = CryptContext(schemes=["bcrypt"]).hash("senha-de-teste")


class Response:
    def __init__(self, status_code, headers, content):
        self.status_code, self.headers, self.content = status_code, headers, content

    @property
    def text(self):
        return self.content.decode("utf-8", "replace")

    def json(self):
        return jsonlib.loads(self.content)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Client:
    """Redirects are never followed, so a redirect away from the origin stays visible."""

    def __init__(self, base_url, timeout=30):
        self.base_url, self.timeout = base_url.rstrip("/"), timeout
        self.opener = urllib.request.build_opener(NoRedirect)

    def request(self, method, path, json=None, headers=None, files=None):
        data, sent = None, dict(headers or {})
        if json is not None:
            data = jsonlib.dumps(json).encode()
            sent["Content-Type"] = "application/json"
        elif files is not None:
            boundary = "----capacitaSmoke"
            body = b""
            for field, (name, stream, content_type) in files.items():
                body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; "
                         f"filename=\"{name}\"\r\nContent-Type: {content_type}\r\n\r\n").encode()
                body += stream.read() + b"\r\n"
            data = body + f"--{boundary}--\r\n".encode()
            sent["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        request = urllib.request.Request(self.base_url + path, data=data, headers=sent, method=method)
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                return Response(response.status, dict(response.headers), response.read())
        except urllib.error.HTTPError as error:
            return Response(error.code, dict(error.headers), error.read())

    def get(self, path, **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path, **kwargs):
        return self.request("POST", path, **kwargs)

    def patch(self, path, **kwargs):
        return self.request("PATCH", path, **kwargs)

    def put(self, path, **kwargs):
        return self.request("PUT", path, **kwargs)


DB = sys.argv[1] if len(sys.argv) > 1 else "./smoke.db"
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3000"
RUN = time.strftime("%H%M%S")
ADMIN, MEMBER, RENAMED = f"admin{RUN}@infoej.com.br", f"membro{RUN}@infojr.com.br", f"membro{RUN}b@infojr.com.br"
client = Client(BASE)
passed, failed = [], []


def check(label, condition, extra=""):
    (passed if condition else failed).append(label)
    print(("PASS  " if condition else "FALHA ") + label + (f" :: {extra}" if extra and not condition else ""))


def account(name, email, kind, eixo=None):
    """Creates the account straight in the database: there is no public registration."""
    if kind == "trainee":
        registered = client.post("/api/auth/register", json={"name": name, "email": email, "cargo": name, "password": "senha-de-teste"})
        check("não há cadastro público", registered.status_code == 404, registered.text[:200])
    database = sqlite3.connect(DB)
    database.execute(
        "INSERT INTO users (id, name, email, password_hash, cargo, type, eixo, photo, pontos_acumulados, failed_login_attempts)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, '', 0, 0)",
        (str(uuid.uuid4()), name, email, PASSWORD_HASH, name, kind, eixo))
    database.commit()
    database.close()
    session = client.post("/api/auth/login", json={"email": email, "password": "senha-de-teste"})
    assert session.status_code == 200, session.text
    return {"Authorization": "Bearer " + session.json()["access_token"]}


def check_creation_routes(admin):
    for path, payload in [("/api/materials", {"name": "Material", "type": "membro", "eixo": "vendas", "text": "Conteúdo"}),
                          ("/api/activities", {"title": "Atividade", "eixo": "vendas"})]:
        direct = client.post(path, json=payload, headers=admin)
        check(f"POST {path} responde sem redirecionamento",
              direct.status_code == 200 and "location" not in direct.headers, f"{direct.status_code} {direct.text[:120]}")
        # A trailing slash may redirect inside the origin; leaving it is what drops the
        # Authorization header and shows "credenciais inválidas ou sessão expirada".
        slashed = client.post(path + "/", json=payload, headers=admin)
        location = slashed.headers.get("location") or slashed.headers.get("Location") or ""
        check(f"POST {path}/ não sai da origem",
              slashed.status_code == 200 or location.startswith("/") or location.startswith(BASE),
              f"{slashed.status_code} -> {location}")
        if slashed.status_code in (301, 302, 307, 308):
            followed = client.post(location.replace(BASE, "") or path, json=payload, headers=admin)
            check(f"POST {path}/ mantém a sessão ao seguir o redirecionamento",
                  followed.status_code == 200, f"{followed.status_code} {followed.text[:120]}")


def check_upload(admin):
    sent = client.post("/api/upload", files={"file": ("smoke.txt", io.BytesIO(b"arquivo de teste"), "text/plain")}, headers=admin)
    check("upload multipart pelo proxy", sent.status_code == 200 and sent.json().get("url", "").startswith("/api/uploads/"), sent.text[:200])
    if sent.status_code != 200:
        return
    served = client.get(sent.json()["url"], headers=admin)
    check("arquivo enviado é servido pelo proxy", served.status_code == 200 and served.content == b"arquivo de teste", str(served.status_code))
    anonymous = client.get(sent.json()["url"])
    check("proxy exige autenticação", anonymous.status_code in (401, 403), str(anonymous.status_code))


QUIZ = {"questions": [
    {"id": "q1", "text": "Pergunta única", "selection": "single", "weight": 2, "explanation": "Explicação",
     "options": [{"id": "a", "text": "Certa", "is_correct": True, "feedback": "Boa"},
                 {"id": "b", "text": "Errada", "is_correct": False, "feedback": ""}]},
    {"id": "q2", "text": "Pergunta múltipla", "selection": "multiple", "weight": 1, "explanation": "",
     "options": [{"id": "c", "text": "Uma", "is_correct": True, "feedback": ""},
                 {"id": "d", "text": "Outra", "is_correct": True, "feedback": ""},
                 {"id": "e", "text": "Não", "is_correct": False, "feedback": ""}]}]}
BOARDS = {
    "matching": {"pairs": [{"id": "p1", "right_id": "r1", "left": "Item um", "right": "Par um", "feedback": "Observação"},
                           {"id": "p2", "right_id": "r2", "left": "Item dois", "right": "Par dois", "feedback": ""}],
                 "distractors": [{"id": "d1", "right": "Par extra"}]},
    "ordering": {"items": [{"id": "i1", "text": "Primeira etapa"}, {"id": "i2", "text": "Segunda etapa"},
                           {"id": "i3", "text": "Terceira etapa"}], "explanation": "Ordem do processo."},
    "categorization": {"categories": [{"id": "c1", "text": "Categoria A", "description": "Descrição"},
                                      {"id": "c2", "text": "Categoria B", "description": ""}],
                       "items": [{"id": "i1", "text": "Item um", "category_id": "c1", "feedback": "Observação"},
                                 {"id": "i2", "text": "Item dois", "category_id": "c2", "feedback": ""}]},
}
CORRECT = {
    "matching": {"matches": [{"left_id": "p1", "right_id": "r1"}, {"left_id": "p2", "right_id": "r2"}]},
    "ordering": {"order": ["i1", "i2", "i3"]},
    "categorization": {"placements": [{"item_id": "i1", "category_id": "c1"}, {"item_id": "i2", "category_id": "c2"}]},
}
INCOMPLETE = {
    "matching": {"matches": [{"left_id": "p1", "right_id": "r1"}]},
    "ordering": {"order": ["i1", "i2"]},
    "categorization": {"placements": [{"item_id": "i1", "category_id": "inexistente"}, {"item_id": "i2", "category_id": "c2"}]},
}


def publish(admin, fmt, config, title):
    draft = client.post("/api/games", json={"title": title, "instructions": "Instruções", "eixo": "vendas", "format": fmt, "config": config}, headers=admin)
    check(f"{fmt}: rascunho criado", draft.status_code == 200, draft.text[:200])
    published = client.post(f"/api/games/{draft.json()['id']}/publish", headers=admin)
    check(f"{fmt}: publicação válida", published.status_code == 200 and published.json().get("published_revision"), published.text[:250])
    return published.json()["published_revision"]["id"]


def node_for(admin, revision, name, released=True):
    created = client.post("/api/nodes", json={"name": name, "type": "game", "eixo": "vendas",
                                              "is_released": released, "game_revision_id": revision}, headers=admin)
    check(f"{name}: etapa criada na trilha", created.status_code == 200, created.text[:200])
    return created.json()["id"]


def check_quiz_attempt(admin, member):
    empty = client.post("/api/games", json={"title": "Rascunho vazio", "eixo": "vendas", "format": "quiz", "config": {}}, headers=admin)
    check("rascunho incompleto é aceito", empty.status_code == 200, empty.text[:200])
    check("publicação rejeita configuração vazia",
          client.post(f"/api/games/{empty.json()['id']}/publish", headers=admin).status_code == 422)
    revision = publish(admin, "quiz", QUIZ, "Questionário")
    node = node_for(admin, revision, "Etapa questionário", released=False)
    check("etapa bloqueada não inicia tentativa", client.post(f"/api/nodes/{node}/attempts", headers=member).status_code == 403)
    released = client.patch(f"/api/nodes/{node}/release", json={"is_released": True}, headers=admin)
    check("liberação preserva o vínculo do jogo", released.status_code == 200 and released.json()["game_revision_id"] == revision, released.text[:200])

    attempt = client.post(f"/api/nodes/{node}/attempts", headers=member).json()
    check("tentativa não expõe gabarito",
          all("is_correct" not in option and "feedback" not in option for question in attempt["questions"] for option in question["options"]))
    check("tentativa é retomada sem duplicar", client.post(f"/api/nodes/{node}/attempts", headers=member).json()["id"] == attempt["id"])
    path = f"/api/game-attempts/{attempt['id']}/complete"
    check("escolha única rejeita duas alternativas",
          client.post(path, json={"answers": [{"question_id": "q1", "option_ids": ["a", "b"]}, {"question_id": "q2", "option_ids": ["c", "d"]}]}, headers=member).status_code == 400)
    check("pontuação enviada pelo navegador é recusada",
          client.post(path, json={"answers": [{"question_id": "q1", "option_ids": ["a"]}], "score": 999999}, headers=member).status_code == 422)
    done = client.post(path, json={"answers": [{"question_id": "q1", "option_ids": ["a"]}, {"question_id": "q2", "option_ids": ["c", "d"]}]}, headers=member)
    result = done.json().get("result") or {}
    check("resultado calculado pelo servidor",
          done.status_code == 200 and result.get("attempt_score") == 100 and result.get("score_added") == 100, done.text[:250])
    repeated = client.post(path, json={"answers": [{"question_id": "q1", "option_ids": ["b"]}, {"question_id": "q2", "option_ids": ["e"]}]}, headers=member)
    check("reenvio não duplica pontos",
          repeated.status_code == 200 and repeated.json()["result"]["user_total_points"] == result.get("user_total_points"), repeated.text[:200])
    trail = next(item for item in client.get("/api/nodes", headers=member).json() if item["id"] == node)
    check("etapa concluída aparece na trilha", trail["completed"] and trail["user_score"] == 100, str(trail.get("user_score")))


def check_board_formats(admin, member):
    for fmt, config in BOARDS.items():
        node = node_for(admin, publish(admin, fmt, config, f"Jogo {fmt}"), f"Etapa {fmt}")
        attempt = client.post(f"/api/nodes/{node}/attempts", headers=member).json()
        board = attempt["board"]
        check(f"{fmt}: tabuleiro chega sem gabarito",
              board and "is_correct" not in str(board) and "category_id" not in str(board), str(board)[:250])
        if fmt == "matching":
            check("matching: identificadores do tabuleiro não revelam o par",
                  not {card["id"] for card in board["left"]} & {card["id"] for card in board["right"]}, str(board))
        check(f"{fmt}: tabuleiro estável ao reabrir", client.post(f"/api/nodes/{node}/attempts", headers=member).json()["board"] == board)
        path = f"/api/game-attempts/{attempt['id']}/complete"
        check(f"{fmt}: resposta incompleta ou inválida é recusada",
              client.post(path, json=INCOMPLETE[fmt], headers=member).status_code == 400)
        done = client.post(path, json=CORRECT[fmt], headers=member)
        result = done.json().get("result") or {}
        check(f"{fmt}: resultado calculado pelo servidor", done.status_code == 200 and result.get("attempt_score") == 100, done.text[:250])
        check(f"{fmt}: feedback por item retornado", len(result.get("feedback", [])) == len(config.get("pairs") or config["items"]))
        if fmt == "ordering":
            check("ordering: explicação do autor é exibida no resultado", result.get("note") == "Ordem do processo.", str(result.get("note")))


def check_session_rules(admin, member):
    check("sessão ausente é recusada", client.get("/api/auth/me").status_code == 401)
    check("token inválido é recusado", client.get("/api/auth/me", headers={"Authorization": "Bearer invalido"}).status_code == 401)
    member_id = client.get("/api/auth/me", headers=member).json()["id"]
    renamed = client.put(f"/api/users/{member_id}", json={"email": RENAMED}, headers=admin)
    me = client.get("/api/auth/me", headers=member)
    check("token do membro continua válido após troca de email",
          renamed.status_code == 200 and me.status_code == 200 and me.json()["email"] == RENAMED, f"{renamed.status_code} {me.status_code}")
    check("membro não edita usuários", client.put(f"/api/users/{member_id}", json={"name": "Outro"}, headers=member).status_code == 403)
    check("membro não acessa a biblioteca de autoria", client.get("/api/games", headers=member).status_code == 403)


def main():
    admin = account("Administrador", ADMIN, "admin")
    member = account("Membro", MEMBER, "membro", "vendas")
    check_creation_routes(admin)
    check_upload(admin)
    check_quiz_attempt(admin, member)
    check_board_formats(admin, member)
    check_session_rules(admin, member)
    print(f"\n{len(passed)} verificações passaram, {len(failed)} falharam")
    for item in failed:
        print("  FALHOU:", item)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
