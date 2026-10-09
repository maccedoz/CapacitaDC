# Testes e verificação

Execute os comandos a partir da raiz do repositório, exceto quando indicado. Os testes de backend usam SQLite temporário. As jornadas de navegador devem ser executadas com o servidor descartável abaixo, nunca com o banco de uma instalação em uso.

## Backend e TypeScript

```bash
backend/.venv/bin/pip install -r backend/requirements-dev.txt
backend/.venv/bin/ruff check backend
backend/.venv/bin/python -m unittest discover -s backend/tests -v
cd frontend
npm ci
npm run lint
npm run typecheck -- --incremental false
npm run build
```

O CI do GitHub (`.github/workflows/ci.yml`) roda esses mesmos passos em cada PR e em cada push em `main`: ruff e testes do backend; lint, tipos e build do frontend. O lint falha só com erros; os avisos de `any` explícito e de `setState` em efeitos ainda são tolerados.

As suítes cobrem autenticação, permissões, criação e contratos das rotas, conteúdo bloqueado, conclusão das etapas, avaliação dos cinco formatos de jogos, tentativas repetidas, publicações, migrações, média ponderada e fila de correção. `test_access.py` também cobre a ausência de cadastro público, o bloqueio do login após 5 senhas erradas, a resposta igual para e-mail inexistente e o tamanho mínimo de senha; `test_managers.py` cobre a conferência da assinatura dos arquivos enviados.

`test_managers.py` cobre o gerente por eixo com dados descartáveis para os três eixos: nomeação pelo administrador e eixo obrigatório; gestão do PlugInfo (trainees, rotação, conteúdo e correções do eixo `trainee`) sem promoção de trainees; cada gerente contra os outros dois eixos, por listagem e por ID; requisições manipuladas (promoção, troca de eixo ou cargo, edição de outros gerentes); conteúdo `all`/`trainee` e vínculos cruzados; vínculos antigos compartilhados; correções que exigem membro e atividade do eixo; notas e perfil contados só no eixo; participantes sem acesso à lista de pessoas; nomes de eixo antigos equivalentes aos códigos e eixo desconhecido sem acesso; mudança de papel valendo para a sessão aberta; biblioteca com três etapas alcançadas de dez, agendamento, pré-requisito pendente, múltiplos vínculos e trilha não autorizada; e download de documentos por URL direta.

## Preparar testes no navegador

Os scripts usam Playwright, que é dependência de desenvolvimento do frontend (`npm ci` já o instala). Falta só baixar o navegador uma vez:

```bash
cd frontend
npx playwright install chromium
```

Cada jornada tem um script npm: `test:ui`, `test:release`, `test:deadlines`, `test:progress`, `test:games`, `test:corrections`, `test:assessments`, `test:attachments` e `test:manager`.

Alternativamente, `PLAYWRIGHT_PACKAGE` pode apontar para uma instalação de Playwright já disponível, e `PLAYWRIGHT_BROWSERS_PATH` para seus navegadores. Esses caminhos são configuração da máquina, não devem ser versionados.

Abra dois terminais:

```bash
# Terminal 1 — API real, com banco e uploads descartáveis.
backend/.venv/bin/python backend/tests/serve.py --port 8021
```

```bash
# Terminal 2 — frontend com cache independente do servidor habitual.
cd frontend
NEXT_DIST_DIR=.next-qa API_BACKEND_URL=http://127.0.0.1:8021 npm run dev -- --port 3017
```

O servidor de teste cria as contas `admin@example.com`, `organizador@example.com`, `membro@example.com` e `trainee@example.com`, além de um gerente e um membro por eixo (`gerente-vendas@example.com`, `membro-vendas@example.com`, e o mesmo para `conexoes` e `experiencia`), todas com senha `qa-test-password`. Essas contas existem somente no banco descartável; nenhuma conta de gerente é criada em produção. Ao encerrar a API, os dados temporários são removidos.

## Interface e sessão

Só precisa do frontend; as respostas da API são simuladas:

```bash
BASE_URL=http://127.0.0.1:3017 node frontend/tests/stabilization.cjs
```

Verifica sessão expirada, indisponibilidade temporária, preservação de formulários após falha, reenvio de atividades, autoria e vínculo material → atividade → nó, leitura de texto e recursos pelo nó, abertura de conteúdo após desbloquear etapas, atualização ao abrir nós, recuperação de falhas de carregamento, conteúdo ausente e recuperação de senha indisponível.

## Agendamento e prazos

Com o frontend disponível, sem precisar de uma API real:

```bash
BASE_URL=http://127.0.0.1:3017 node frontend/tests/node_release.cjs
BASE_URL=http://127.0.0.1:3017 node frontend/tests/deadlines.cjs
```

`node_release.cjs` intercepta a API e controla o relógio do navegador para verificar fusos, preservação do horário após salvar, edição durante atualização automática, consultas antigas terminando após o salvamento, novas edições durante uma gravação, falha com reenvio, atualização do status na liberação e nova consulta quando a leitura do horário de liberação falha ou chega atrasada (inclusive na trilha do participante). Usa a mesma configuração de Playwright descrita acima; também está disponível como `npm run test:release` no frontend.

`deadlines.cjs` verifica, nos fusos da Bahia e de Kolkata e com respostas antigas sem `Z`, a exibição dos prazos no painel (atividades e trilha), na aba de atividades do trainee e na etapa aberta por trainees e membros, em que o prazo da etapa prevalece sobre o da atividade. Também verifica que salvar a edição de uma atividade ou de um nó sem mexer no prazo mantém o mesmo instante. Disponível como `npm run test:deadlines`.

`test_nodes.py` verifica na API a equivalência entre UTC e outros offsets, retorno com fuso explícito, compatibilidade com registros antigos, recusa de entradas sem fuso, liberação antes/no/depois do instante, pré-requisitos, liberação imediata e revogação. `test_nodes.py` e `test_access.py` cobrem o mesmo contrato para os prazos de nós e de atividades, incluindo o fechamento das entregas exatamente no prazo. Esses testes usam SQLite descartável; não substituem a validação com PostgreSQL de produção.

## Nota mínima, acerto parcial, comemoração e gamificação

Com o frontend disponível, sem precisar de uma API real:

```bash
BASE_URL=http://127.0.0.1:3017 node frontend/tests/progress_journey.cjs
```

Verifica o resultado de um questionário com questão parcialmente correta (contagem de alternativas e pontos), o aviso de nota mínima 7 com **Tentar novamente** até concluir a etapa, a comemoração ao concluir a trilha (uma vez por conjunto de etapas, sem contar opcionais e sem balões com movimento reduzido) e a aba **Conquistas** do membro (nível, conquistas e ranking por eixo e geral). Disponível como `npm run test:progress`.

`test_games.py` cobre a nota parcial da seleção múltipla, com o desconto por alternativa incorreta marcada ou correta não marcada (inclusive os exemplos de 33,3% e 50%). `test_assessments.py` cobre a nota mínima nos jogos com repetição (6,9 reprova, 7,0 aprova), o bloqueio da etapa seguinte, a tentativa única concluindo com qualquer nota e o quiz antigo. `test_gamification.py` cobre acesso só de membros, pontos a partir das notas, níveis, conquistas e empates no ranking.

As jornadas `stabilization.cjs`, `assessments_journey.cjs` e `submission_attachments_journey.cjs` concluem a trilha inteira e, por isso, fecham a comemoração antes de continuar.

## Fila de correções e notas

Com os dois servidores preparados:

```bash
BASE_URL=http://127.0.0.1:3017 ADMIN_EMAIL=admin@example.com \
  TRAINEE_EMAIL=trainee@example.com PASSWORD=qa-test-password \
  node frontend/tests/corrections_journey.cjs
```

Cria entregas na API de teste e usa o navegador para lançar notas, consultar a média ponderada e filtrar pendentes/corrigidas. Verifica a atualização da média sem lançamento manual no perfil.

## Biblioteca e trilhas

Reinicie a API de teste para começar com um banco limpo, pois a trilha sequencial pode bloquear etapas novas após dados deixados por outra execução:

```bash
BASE_URL=http://127.0.0.1:3017 ADMIN_EMAIL=admin@example.com \
  TRAINEE_EMAIL=trainee@example.com PASSWORD=qa-test-password \
  node frontend/tests/games_journey.cjs
```

Percorre autoria, pré-visualização, publicação, vínculo com a trilha, liberação, jogo e atualização do progresso. Também confere a exclusão do jogo: recusada com a mensagem do servidor enquanto duas etapas o usam, liberada depois de removê-las (mesmo já havendo uma tentativa concluída).

## Repetição, obrigatoriedade e peso

Com uma API descartável nova (a média esperada considera só as notas criadas pelo roteiro):

```bash
BASE_URL=http://127.0.0.1:3017 ADMIN_EMAIL=admin@example.com \
  TRAINEE_EMAIL=trainee@example.com PASSWORD=qa-test-password \
  node frontend/tests/assessments_journey.cjs
```

O administrador cria pela interface uma etapa de jogo sem repetição, obrigatória e com peso 3, e uma atividade de envio único com peso 2. O trainee joga (nota 10/10), não vê opção de repetir e reencontra o resultado ao recarregar; entrega a atividade e não recebe novo formulário. Com a entrega corrigida com nota 4, a aba **Notas** mostra a média 7,60. O administrador libera a repetição em **Editar nó**; uma tentativa pior mostra a melhor nota e mantém a média. A página do jogo é conferida na largura de celular.

`test_assessments.py` cobre também a melhor nota entre reenvios e a correção da nota atual, recálculo ao mudar peso, obrigatoriedade ou excluir a etapa, etapas opcionais fora da média e sem bloquear a seguinte, validação de peso, tentativa em andamento quando a repetição é desligada, quizzes antigos, média do gerente por eixo e a migração 6.

## Entregas com anexos

Com uma API descartável nova e o frontend conectado a ela:

```bash
BASE_URL=http://127.0.0.1:3017 node frontend/tests/submission_attachments_journey.cjs
```

Verifica PDF e CSV enviados direto ao armazenamento, limites de quantidade/tamanho/formato (inclusive a recusa do token acima de 20 MB), campos de links e comentários, preservação após falha, conclusão da etapa, reenvio que invalida a nota, download autenticado e exibição na correção. O navegador enviaria os anexos ao Vercel Blob; a jornada redireciona essas requisições para a API descartável, que guarda os arquivos em memória. Por isso, num navegador comum conectado ao servidor descartável, o envio de anexos falha: o token de teste não vale no Blob real. A suíte `test_submission_attachments.py` cobre também propriedade dos anexos, token emitido para outra pessoa ou nunca usado, arquivos fora dos limites, atividade bloqueada/fechada, formato do token do Blob, download em partes e migração de entregas antigas.

## Gerente por eixo

Com uma API descartável nova (a trilha é sequencial) e o frontend conectado a ela:

```bash
BASE_URL=http://127.0.0.1:3017 PASSWORD=qa-test-password node frontend/tests/manager_journey.cjs
```

O administrador nomeia um gerente pela interface (o eixo é obrigatório); o gerente de Conexões vê o painel identificado, os membros e materiais do eixo e os trainees, cria um material com eixo travado e link clicável na pré-visualização e um material do PlugInfo, e tem recusadas pela API as tentativas de alterar Vendas, promover membros ou criar gerentes. Um membro vê na biblioteca só os materiais alcançados, com links clicáveis. Por fim, o administrador troca o eixo do gerente com a sessão aberta e o painel passa a refletir o novo eixo.

## Upload e proxy

`backend/tests/live_smoke.py` verifica a API através do proxy Next.js, incluindo upload multipart e leitura do arquivo. O upload grava num Vercel Blob privado de verdade, então o processo da API também precisa de `BLOB_READ_WRITE_TOKEN` no ambiente. Ele recebe o caminho SQLite que o servidor de teste imprime:

```bash
backend/.venv/bin/python backend/tests/live_smoke.py /tmp/caminho-impresso/database.db http://127.0.0.1:3017
```

Use uma execução nova do servidor descartável para esse roteiro. Ele altera apenas contas do banco de teste para preparar os perfis necessários.

## Limites da validação

SQLite verifica regras e migrações sem depender do PostgreSQL. Isso não substitui validar a atualização de uma cópia do banco PostgreSQL antes de produção. Testes com API simulada verificam a interface; as jornadas reais e o teste do proxy verificam a integração.

Não publique relatórios temporários, bancos, capturas de tela, caches de navegador ou planos pessoais junto com o código.
