# Funcionamento do Capacita DC

## Papéis e públicos

| Papel | Responsabilidade |
| --- | --- |
| Administrador | Cadastra e gerencia pessoas, materiais, atividades, jogos e trilhas; consulta e corrige entregas de membros e trainees. |
| Organizador do PlugInfo | Cadastra e gerencia trainees e seu conteúdo; acompanha entregas e corrige atividades desse público. Não entrega atividades nem acumula progresso de participante. |
| Gerente | Vinculado a um único eixo comercial. Gerencia os membros, materiais, atividades, jogos e a trilha desse eixo e corrige as entregas dos seus membros. Também faz tudo o que o organizador do PlugInfo faz: trainees e conteúdo do eixo `trainee`. Não entrega atividades nem acumula progresso de participante. |
| Membro | Consome conteúdo comercial, joga, entrega atividades e acompanha seus resultados. |
| Trainee | Consome conteúdo para trainees, joga, entrega atividades e acompanha seus resultados. |

**PlugInfo é o nome da organização/papel, não um eixo de conteúdo.** Os eixos comerciais são Vendas, Conexões e Experiência do Consumidor. `trainee` identifica o público da capacitação inicial; `all` é o alcance compartilhado de um conteúdo, não outro eixo comercial. O organizador gerencia conteúdo de trainees; conteúdo compartilhado `all` é administrado pelo administrador.

A API verifica permissões também nas operações por ID. Ocultar botões na interface não é a única proteção. Contas administrativas usam a pré-visualização dos jogos, que não gera pontos.

### Gerentes por eixo

Somente o administrador nomeia gerentes, troca seu eixo ou os remove do cargo; o eixo é obrigatório e deve ser `vendas`, `conexoes` ou `experiencia`. Pode haver mais de um gerente no mesmo eixo. Papel e eixo são lidos do banco a cada requisição, então uma mudança feita pelo administrador vale também para sessões já abertas. Um gerente com eixo ausente ou desconhecido não tem acesso de gestão.

| Operação | Próprio eixo | PlugInfo (`trainee`) | Outros eixos e `all` |
| --- | --- | --- | --- |
| Listar, consultar, cadastrar, editar (inclusive senha) e excluir pessoas | Sim, membros do eixo | Sim, trainees (inclusive rotação) | Não |
| Promover, mudar perfil, cargo ou eixo de alguém | Não | Não (trainee continua trainee) | Não |
| Nomear ou editar gerentes, administradores e organizadores | Não | Não | Não |
| Materiais, documentos e vídeos | Sim, tipo membro | Sim, tipo trainee | Não |
| Etapas, ordem, liberação e agendamento da trilha | Sim | Sim | Não |
| Atividades e jogos | Sim | Sim | Não; conteúdo `all` fica visível, como para o organizador, mas não é editável |
| Consultar e corrigir entregas, baixar anexos | Sim, de membros do eixo em atividades do eixo | Sim, de trainees | Não |
| Notas, progresso e perfil | Membros contados só na trilha do eixo | Trainees como o organizador os vê | Não |

Os vínculos também são conferidos: não é possível ligar material, atividade, jogo ou pré-requisito de outro eixo, nem mover um recurso para fora do escopo do gerente (o eixo dele e o PlugInfo). Um gerente sem eixo válido perde também o acesso ao PlugInfo. Como membros enxergam as trilhas dos três eixos, uma atividade pode ter entregas de membros de outro eixo; nesse caso excluí-la ou mudar seu peso ou obrigatoriedade (o que alteraria notas de outras pessoas) fica com o administrador. A mesma regra vale para etapas de jogo com notas de membros de outro eixo. O mesmo vale para conteúdos antigos compartilhados com a trilha de outro eixo.

Usuários antigos podem ter o eixo gravado pelo nome de exibição ("Vendas", "Conexões", "Experiência do Consumidor"). Esses nomes exatos produzem a mesma autorização que os códigos; valores desconhecidos negam o acesso em vez de serem adivinhados. Novas gravações usam o código, e a interface exibe o nome completo.

## Caminhos principais

- `/login`: autenticação. Não há cadastro público: membros e trainees nunca criam a própria conta; a gestão cadastra as pessoas no painel, sempre com senha de pelo menos 6 caracteres.
- `/`: painel de administração, com pessoas, materiais, atividades, **Correções**, notas e trilhas. Para o gerente, o painel se identifica como **Gerente — <eixo>** e mostra apenas o seu escopo: o eixo e o PlugInfo.
- Aba **Atividades → Jogos** no painel (também disponível em `/jogos`): biblioteca e autoria de jogos, acessível a administradores, organizadores e gerentes (estes, no próprio eixo e no PlugInfo).
- `/membros` e `/trainees`: consumo de conteúdo, trilhas e entregas.
- `/perfil/[id]`: consulta administrativa do progresso, entregas e média calculada. A média não é editada nesse perfil.
- `/recuperar-senha`: informa que a recuperação automática está indisponível e orienta procurar a administração; não simula envio de email.

## Atividades, entregas e correções

### Preparar a atividade

Na aba **Atividades**, cadastre título, descrição, público, exigência de arquivo/link, prazo opcional, material de apoio opcional e as regras de avaliação: **Permitir repetição**, **Obrigatória (vale nota)** e **Peso da nota**. As mesmas três opções existem nas etapas de jogo, na criação e em **Editar nó**; numa etapa de atividade elas vêm da atividade vinculada.

- Peso maior dá maior participação na média.
- **Obrigatória exige peso maior que zero.** Uma atividade opcional não entra na média; ela ainda pode receber correção e feedback.
- Peso omitido usa 1. Pesos negativos ou não numéricos são rejeitados.
- Sem repetição, cada pessoa faz uma única entrega: a segunda entrega e o envio de novos anexos são recusados (409). Com repetição (o padrão), vale a melhor nota.
- Arquivo exigido: a entrega precisa incluir uma URL. Atividade sem arquivo exigido aceita um comentário; entregas completamente vazias são rejeitadas.

Atividades podem ser associadas a etapas da trilha. Uma entrega válida conclui a etapa correspondente no servidor; essa conclusão não depende de já existir uma nota e não atribui a bonificação dos jogos. A chamada de entrega informa o ID da etapa quando ocorre pela trilha.

### Corrigir uma entrega

1. Entre no painel administrativo e abra **Correções**.
2. Filtre por pendentes/corrigidas, tipo de participante, eixo ou atividade. A fila tem paginação.
3. Consulte a pessoa, a atividade, o peso, a data, o comentário e o link enviado. O link abre em outra aba.
4. Digite a **nota de 0 a 10**, acrescente feedback e salve. Uma nota zero é válida.
5. A média da pessoa é recalculada e a planilha de notas atualiza. No filtro de pendentes, a entrega corrigida sai da fila.

A mesma correção também pode ser feita na lista de envios dentro de uma atividade. O administrador acompanha membros e trainees; o organizador só recebe na fila os envios de trainees em atividades que pode gerenciar; o gerente, os envios de membros do próprio eixo em atividades desse eixo — estar numa atividade do eixo não basta — e os de trainees, como o organizador.

Ao reenviar conteúdo diferente, a entrega volta a pendente, e a melhor nota das entregas anteriores (`previous_grade`) continua valendo na média até a nova correção; vale a maior entre ela e a nova nota. Corrigir de novo a mesma entrega substitui a nota dela, para desfazer um lançamento errado. Repetir a mesma entrega não duplica seu registro nem remove uma correção sem mudança no conteúdo.

### Cálculo da nota da rotação

A nota é a média ponderada das **atividades obrigatórias já corrigidas** e dos **jogos obrigatórios concluídos**:

```text
média = soma(nota × peso) / soma(dos pesos considerados)
```

A nota de um jogo é `10 × pontos obtidos / pontos possíveis`, de 0 a 10, calculada pelo servidor ao concluir; vale a melhor tentativa. Quizzes antigos sem pesos nas alternativas usam a proporção de acertos. Um jogo com repetição ainda abaixo da nota mínima 7 entra na média com a melhor nota obtida, mesmo sem concluir a etapa.

Exemplo de cálculo: entrega com nota 4 e peso 2, e jogo com nota 10 e peso 3, resultam em `(4×2 + 10×3) / 5 = 7,60`.

Entregas pendentes e atividades ou jogos opcionais não reduzem a média. Sem notas obrigatórias, a média fica ausente (`null`), não zero. O resultado é arredondado para duas casas decimais. Essa regra vale para membros e trainees; para o gerente, a média exibida considera só as atividades e jogos do eixo dele.

O backend recalcula quando uma nota é salva, quando um jogo é concluído, quando o peso ou a obrigatoriedade de uma atividade ou etapa de jogo muda e quando uma atividade ou etapa de jogo é excluída. `users.nota_rotacao` é um cache calculado para manter compatibilidade com as respostas da API, e não um campo de lançamento manual. A rotação/ciclo do trainee (`rotacao`) continua sendo um dado administrativo separado.

Para trainees, o frontend não exibe troféus, pontos nem bonificações; mostra conclusão, nota e feedback das respostas. Os registros históricos de pontuação (até 100 pontos por etapa, `pontos_acumulados`) permanecem no servidor e não entram na média nem na gamificação dos membros: elas usam a nota de 0 a 10.

### Gamificação dos membros

Exclusiva para o perfil **membro**: `GET /api/gamification` responde 403 para trainees e perfis administrativos, e a aba **Conquistas** existe só no portal do membro. Nada é gravado: tudo é recalculado a cada consulta a partir das notas, então correções e novas tentativas valem na hora.

- **Pontos:** cada jogo (melhor nota) e cada entrega corrigida (nota efetiva, a maior entre a atual e a anterior) vale `nota × 10`, de 0 a 100. Opcionais também pontuam; entregas pendentes não.
- **Nível:** 1 Iniciante (0), 2 Aprendiz (100), 3 Praticante (250), 4 Competente (450), 5 Avançado (700), 6 Especialista (1000) e 7 Mestre (1400 pontos). O cabeçalho mostra nível e pontos; a aba mostra quanto falta para o próximo.
- **Conquistas:** Primeiro passo (concluir uma etapa), Nota máxima (um 10), Persistente (ser aprovado num jogo depois de uma tentativa abaixo de 7), Consistente (7 ou mais em cinco avaliações) e Trilha concluída (todas as etapas obrigatórias do eixo do membro). As que têm meta mostram o progresso.
- **Ranking:** todos os membros por pontos, com empates na mesma posição (1, 1, 3). A aba começa no eixo do membro, com posições recalculadas dentro dele, e alterna para o geral. Mostra nome, eixo, nível e pontos; notas individuais não aparecem.

## Trilhas e acesso ao conteúdo

O fluxo de autoria de conteúdo é **material → atividade → nó**: crie o material na biblioteca, selecione-o na atividade e vincule a atividade ao nó. Materiais também podem existir apenas na biblioteca, sem atividade ou nó. A criação de nós oferece atividade ou versão publicada de jogo; nós antigos de leitura continuam compatíveis. No gerenciamento da trilha, **Editar nó** permite alterar nome, conteúdo associado, prazo e pré-requisito. Tipo e eixo são preservados. Pré-requisitos que criariam ciclos são rejeitados. Etapas de jogo podem ter um material de apoio opcional, disponível durante o jogo e na biblioteca somente após o desbloqueio da etapa. A leitura desse material não conclui o jogo. Ao selecionar um jogo, membros e trainees navegam para uma página dedicada (`/trilha/{id}/jogar`), com material de apoio e retorno à trilha. As prévias administrativas ocupam a área da página e permitem voltar ao editor mantendo o rascunho. Uma versão de jogo com tentativas registradas não pode ser substituída no mesmo nó. Ao abrir a etapa, `GET /api/nodes/{id}/content` retorna sua atividade, o material dessa atividade (texto, documentos e vídeos) e a entrega do participante, depois de verificar as permissões e o desbloqueio. O leitor não depende da lista de materiais já carregada no navegador. A trilha é sequencial por eixo: a etapa obrigatória anterior na ordem é o pré-requisito implícito, e etapas opcionais não bloqueiam as seguintes. Quando existe um pré-requisito explícito, ele prevalece. As conexões visuais seguem a regra usada pela API.

O administrador pode liberar etapas imediatamente ou agendar a liberação. Participantes só abrem etapas liberadas e com pré-requisitos concluídos.

O agendamento usa o horário local do navegador, com o fuso indicado junto ao campo. A atualização automática preserva alterações ainda não salvas; durante o salvamento, novas edições também ficam preservadas e o botão impede envios duplicados. Campo, legenda e status usam a mesma interpretação de data. Se a consulta feita no horário de liberação falhar ou chegar atrasada, a tela volta a consultar automaticamente.

Prazos de atividades e de nós seguem a mesma conversão: aparecem no horário local do navegador no painel, na trilha e na aba de atividades, e salvar a edição de uma atividade ou de um nó sem mexer no prazo mantém o mesmo horário.

Em `PATCH /api/nodes/{id}/release`, `released_at` exige fuso explícito (por exemplo, `2030-01-02T14:00:00-03:00` ou `2030-01-02T17:00:00Z`); `null` ou omissão mantêm a liberação imediata quando `is_released` é verdadeiro. A mesma regra vale para `deadline` na criação e na edição de atividades e de nós. A API converte esses horários para UTC antes de gravar nas colunas existentes, que guardam UTC sem fuso, independentemente do fuso da conexão com o banco, e sempre responde com `Z`. Datas novas sem fuso retornam 422. Registros antigos continuam sendo interpretados como UTC, conforme a regra anterior; esta correção não migra nem desloca horários já armazenados.

Ao concluir todas as etapas obrigatórias da trilha oficial (a dos trainees, ou a do eixo do membro), o participante vê uma mensagem de parabéns com balões. Ela aparece uma vez para cada conjunto de etapas concluídas (guardado no navegador): se novas etapas forem concluídas depois, a comemoração volta. Se o diálogo de uma etapa estiver aberto, ela espera ele fechar; com movimento reduzido no sistema, os balões não aparecem.

A biblioteca do participante mostra apenas materiais de etapas que ele já **alcançou**: a etapa pertence a uma trilha que ele pode ver, está liberada, o agendamento já passou e o pré-requisito efetivo foi concluído. Alcançar não é concluir: com as etapas 1 e 2 concluídas e a 3 aberta, os materiais das três aparecem. O vínculo é o mesmo usado na leitura da etapa (o material da atividade, ou a referência direta de etapas antigas de leitura); basta uma etapa alcançada para um material com vários vínculos, e ele aparece uma vez. Materiais sem etapa, ou ligados apenas a atividades fora da trilha, ficam restritos à autoria no painel. Bloquear de novo uma etapa ou remover o vínculo recalcula o acesso na consulta seguinte. Atividades fora da trilha continuam visíveis como antes.

URLs `http://` e `https://` no texto de um material viram links clicáveis na pré-visualização do editor, na biblioteca e na leitura pela trilha, inclusive em materiais já existentes. Os links abrem em nova aba; o texto nunca é interpretado como HTML e outros protocolos não viram link. Os vídeos cadastrados também são links clicáveis.

Reordenar muda a sequência implícita. Excluir ou alterar conteúdos já usados pode afetar acesso e progresso; confira os vínculos antes de fazê-lo. Conteúdo já concluído pode continuar sendo consultado conforme as regras de visibilidade.

## Anexos nas entregas

O formulário apresenta **anexos → links → comentários**. Cada entrega aceita até 5 anexos, com até 20 MB por arquivo, até 10 links HTTP/HTTPS e um comentário de até 5.000 caracteres. Os formatos aceitos são PDF, DOC/DOCX/ODT, XLS/XLSX/ODS, PPT/PPTX/ODP, PNG/JPG/JPEG/GIF/WEBP, TXT, CSV e ZIP. Se a atividade exige arquivo, um link não substitui o anexo obrigatório.

Os anexos ficam num Vercel Blob privado (não em disco local, incompatível com o compute stateless da Vercel). Como as funções da Vercel recusam corpos acima de 4,5 MB (erro 413 `FUNCTION_PAYLOAD_TOO_LARGE`), o arquivo não passa pela API: o navegador pede um token em `POST /api/activities/{id}/attachments/upload-token`, emitido só depois de a API verificar o autor, a atividade, a liberação da etapa, o formato e o tamanho informado, e envia o arquivo direto ao Blob. O token vale por 10 minutos, para um único caminho, sem sobrescrever arquivos e até 20 MB. Em seguida, `POST /api/activities/{id}/attachments` confere de novo a atividade e a etapa, se o caminho foi emitido para a pessoa e o tamanho real do arquivo guardado, e registra o anexo, cujo ID é informado ao entregar a atividade. O token é assinado com `BLOB_READ_WRITE_TOKEN`, que precisa estar configurado na API.

Os anexos são baixados por uma rota autenticada pelo autor ou pelos gestores autorizados após a entrega; a resposta é enviada em partes (streaming), porque respostas comuns das funções também são limitadas a 4,5 MB. Eles aparecem na entrega, na fila de correções e no perfil. Alterar anexos, links ou comentário invalida a correção anterior, como já ocorria ao alterar a resposta.

A migração 5 adiciona a lista de links e a tabela de anexos, preservando links e notas das entregas antigas. A pasta privada de anexos também precisa de armazenamento persistente e backup.

## Documentos dos materiais

Documentos enviados por `POST /api/upload` ficam no mesmo Blob privado e são registrados com quem os enviou (e o eixo, no caso de gerentes) na tabela `material_uploads`. `GET /api/uploads/{pathname}` só entrega o arquivo por meio do material que o lista: o participante precisa ter alcançado uma etapa desse material, e a equipe precisa ter o material no próprio escopo. Antes de ser vinculado, o arquivo só é aberto por quem o enviou, por outro gerente do mesmo eixo ou pelo administrador. Arquivos antigos, sem registro de envio, são autorizados pelos documentos já cadastrados; arquivos sem associação verificável são negados. Ao salvar um material, documentos internos precisam ter sido enviados pela pessoa ou pertencer a um material do seu escopo, inclusive quando informados por URL absoluta. Links externos de documentos e vídeos abrem diretamente, sem o token da sessão, e não são controlados pelo aplicativo.

## Jogos disponíveis

O autor cria rascunhos vazios e fornece o conteúdo. A plataforma não gera atividades comerciais específicas automaticamente.

| Formato | Como funciona |
| --- | --- |
| Questionário | Perguntas de escolha única ou múltipla, pesos e explicações. Na seleção múltipla, a questão começa valendo 100% do peso e cada erro (alternativa incorreta marcada ou correta não marcada) desconta `100% ÷ número de alternativas corretas`, com mínimo zero. Por exemplo, com 3 corretas, marcar 2 delas e mais 1 incorreta vale 33,3%; com 2 corretas, marcar as 2 e mais 1 incorreta vale 50%; o resultado mostra a questão como correta, parcialmente correta ou incorreta, com quantas corretas foram marcadas. |
| Cenário situacional | Contexto e decisões que conduzem a outros passos ou encerram o caminho. Cada decisão tem pontos e feedback; ciclos e passos inalcançáveis são rejeitados na publicação. |
| Associação | Relacionar itens de duas listas, com possibilidade de alternativas distratoras. |
| Ordenação | Colocar cartões na sequência correta. |
| Classificação | Distribuir itens entre categorias definidas pelo autor. |

Fluxo de autoria: **criar → salvar rascunho → pré-visualizar → publicar → selecionar a versão na etapa da trilha**. A pré-visualização não grava resultados de participantes.

Publicações são versões imutáveis. Editar um rascunho e publicar outra versão não substitui silenciosamente a versão de etapas existentes. É possível duplicar um jogo para adaptar seu conteúdo. O eixo de um jogo já publicado é preservado; use uma cópia para outro público.

Um rascunho nunca publicado exclui livremente. Um jogo publicado também pode ser excluído, desde que nenhuma versão sua (a atual ou uma anterior) ainda esteja em uso em alguma etapa da trilha; do contrário a etapa perderia o conteúdo. Remova o jogo da etapa (ou a própria etapa) antes de excluir o jogo; a exclusão apaga todas as versões e não pode ser desfeita.

O servidor recebe respostas/decisões e calcula o resultado. Não aceita uma pontuação arbitrária calculada no navegador nem entrega o gabarito antes da avaliação. Os formatos da biblioteca são normalizados para até 100 pontos por etapa; vale o melhor resultado e só a melhora acrescenta pontos à pessoa. Repetir uma requisição de conclusão não pontua novamente.

Com repetição permitida, a etapa só é concluída quando a melhor nota chega a **7**: abaixo disso, o resultado avisa a nota mínima, oferece **Tentar novamente** (sem limite de tentativas) e a etapa seguinte continua bloqueada. Uma tentativa pior depois da aprovação não reabre a etapa, e progressos concluídos antes desta regra continuam concluídos. Abrir o jogo de novo começa outra tentativa, e o resultado mostra a nota da tentativa e a melhor nota. Sem repetição, qualquer nota conclui a etapa. Sem repetição, a primeira tentativa concluída é definitiva: abrir de novo mostra o resultado, e uma tentativa em andamento quando a repetição for desligada não pode mais ser concluída.

Cenários salvam as decisões no servidor. Os demais formatos mantêm as escolhas em andamento no navegador para retomada da tentativa; a avaliação é enviada ao concluir. Essa retomada local depende do mesmo navegador. Quizzes antigos continuam funcionando pelo fluxo legado de respostas avaliadas no servidor, com os pesos originais.

### Outros formatos possíveis, ainda não implementados

| Ideia | Aproveitamento e uso genérico |
| --- | --- |
| Verdadeiro ou falso com justificativa | Variação do questionário para revisar conceitos. |
| Preencher lacunas | Completar frases/termos, com regras de tolerância a acentos e maiúsculas. |
| Identificação de erros | Marcar problemas em um texto ou fluxo de atendimento. |
| Priorização com acerto parcial | Evoluir a ordenação para comparar prioridades, sem exigir uma única sequência rígida. |
| Jogo da memória | Outra interface para associação de conceitos. |
| Simulação de tempo e orçamento | Distribuir recursos e analisar consequências de decisões comerciais. Exige novo motor de avaliação. |
| Flashcards | Revisão e autoavaliação, em modo de prática separado da pontuação avaliada. |
| Grau de confiança | Combinar respostas com a confiança declarada para identificar lacunas de conhecimento. |
| Imagem interativa | Identificar regiões ou elementos em diagramas/imagens; exige editor de regiões. |

Diálogos com ramificações já podem ser representados pelo cenário; uma versão com estado, recursos ou negociação dinâmica seria uma evolução desse formato. Cronômetro, embaralhamento, limite de tentativas e medalhas são recursos compartilhados, não tipos de jogo.

## Segurança do acesso

- **Login:** 5 senhas erradas seguidas para o mesmo e-mail bloqueiam o login por 15 minutos (resposta 429, com o tempo restante). Um login certo zera a contagem. O contador fica no banco, porque a API roda em funções serverless. Um e-mail inexistente recebe a mesma resposta e leva o mesmo tempo que uma senha errada.
- **Senhas:** pelo menos 6 caracteres, conferidos também no servidor, ao cadastrar e ao redefinir. Não existe senha padrão.
- **CORS:** desligado por padrão, porque o navegador chama a API pela mesma origem. Origens extras entram por `CORS_ORIGINS`.
- **Uploads de materiais:** além da extensão, o servidor confere a assinatura do arquivo (PDF, imagens, ZIP e formatos do Office). TXT e CSV não têm assinatura.
- **Erros:** falhas não tratadas são registradas no log da API com o rastreio e respondem 500 sem detalhes internos.

## Arquitetura e contratos

- `frontend/app/`: páginas e composição dos fluxos.
- `frontend/features/`: tipos, chamadas de API e hooks de cada recurso.
- `frontend/components/`: formulários, fila de correções, trilhas e jogos.
- `backend/app/api/`: rotas HTTP.
- `backend/app/services/roles.py`: papéis e normalização dos eixos de membros.
- `backend/app/services/access.py`: escopo de acesso, gestão de pessoas, vínculos entre eixos e pré-requisitos.
- `backend/app/services/node_service.py`: trilha, desbloqueio e conteúdos alcançados pelo participante.
- `backend/app/services/material_files.py`: autorização dos documentos dos materiais.
- `backend/app/services/activity_service.py`: média ponderada e serialização de entregas.
- `backend/app/services/game_service.py`: publicações, tentativas e avaliação.
- `backend/app/models.py`, `schemas.py` e `game_schemas.py`: persistência e validação.
- `backend/app/migrations.py`: evolução versionada do banco.

Rotas principais (consulte `/docs` na API para o contrato completo):

| Recurso | Rotas |
| --- | --- |
| Sessão | `POST /api/auth/login`, `GET /api/auth/me` |
| Saúde | `GET /api/health` (confere o banco) |
| Pessoas | `GET/POST /api/users`, `PUT/DELETE /api/users/{id}`, `GET /api/users/{id}/profile` (somente gestão: participantes não listam pessoas) |
| Materiais | `GET/POST /api/materials`, `PUT/DELETE /api/materials/{id}` |
| Atividades | `GET/POST /api/activities`, `PATCH/DELETE /api/activities/{id}` |
| Entregas | `POST /api/activities/{id}/submit`, `GET /api/activities/{id}/submissions` |
| Correção | `PATCH /api/activities/{id}/submissions/{submission_id}` |
| Fila | `GET /api/submissions`, com filtros de situação, pessoa, tipo, eixo, atividade e paginação |
| Notas | `GET /api/grades` |
| Trilhas | `GET/POST /api/nodes`, liberação, ordenação, conclusão e exclusão por ID |
| Conteúdo da etapa | `GET /api/nodes/{id}/content`, `PATCH /api/nodes/{id}/activity` |
| Jogos | `GET/POST /api/games`, edição, duplicação, publicação e versões por ID |
| Tentativas | `POST /api/nodes/{id}/attempts`, leitura e respostas/conclusão em `/api/game-attempts/{id}` |
| Arquivos | `POST /api/upload`, leitura autorizada pelo material em `GET /api/uploads/{pathname}` |

As coleções aceitam as formas de URL utilizadas no frontend sem redirecionar a autenticação. As sessões novas usam ID de usuário estável no token. Respostas 401 significam sessão inválida, 403 falta de permissão, 422 erro de validação e 5xx falha do servidor. Erro temporário de `/auth/me` não apaga a sessão. A interface mostra o motivo de uma recusa 403 e confere a sessão de novo (também ao voltar para a aba); se papel ou eixo mudaram, o painel se recria sem manter dados do escopo anterior.

## Migrações e manutenção

As migrações rodam na inicialização da API e registram versões em `schema_migrations`:

1. Tabelas da biblioteca/tentativas e referência à versão de jogo nos nós; quizzes legados são preservados.
2. Unicidade do progresso por pessoa/etapa; registros duplicados antigos são consolidados preservando melhor resultado e conclusão, sem recalcular os pontos históricos.
3. Conversão do antigo conteúdo `pluginfo` para `trainee`. Etapas convertidas são colocadas após as existentes e bloqueadas; o papel organizador é preservado.
4. Garantia da coluna de peso, backup das notas manuais antigas em `nota_rotacao_backup_v4` e recálculo das médias pelas entregas corrigidas.
5. Lista de links e tabela de anexos das entregas.
6. Repetição, obrigatoriedade e peso nas atividades e etapas de jogo, nota de 0 a 10 no progresso dos jogos e melhor nota anterior nas entregas. Atividades com peso 0 passam a opcionais; jogos já concluídos recebem a nota pelo melhor resultado registrado; as médias são recalculadas, com backup em `nota_rotacao_backup_v6`.

O papel de gerente reaproveita as colunas `users.type` e `users.eixo` e não exige migração de dados: nomes de eixo antigos são normalizados na leitura e convertidos para o código na próxima gravação. A tabela `material_uploads` é criada na inicialização como as demais tabelas novas.

Antes de atualizar uma instalação, faça backup do PostgreSQL; os uploads vivem num Vercel Blob privado, fora do banco. Bancos, senhas, tokens e caches não pertencem ao Git. Os testes automatizados exercitam as migrações em SQLite; a migração do ambiente PostgreSQL deve ser validada em uma cópia antes de aplicar em produção.

A recuperação automática de senha ainda não está implementada. A plataforma não envia emails de recuperação. A configuração de hospedagem e os comandos de desenvolvimento ficam no [README](../README.md); os procedimentos de verificação estão em [TESTES.md](TESTES.md).
