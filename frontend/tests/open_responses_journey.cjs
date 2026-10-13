// Real API and disposable database; see docs/TESTES.md.
const assert = require("node:assert/strict")
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || "playwright")
const baseURL = process.env.BASE_URL || "http://127.0.0.1:3043"
const password = process.env.PASSWORD || "qa-test-password"
const title = `Perguntas abertas ${Date.now().toString(36)}`
const nodeName = `${title} — etapa`
const notes = "Orientação reservada para a gestão"

async function signIn(page, email) {
  await page.goto(`${baseURL}/login`)
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByLabel("Senha", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Entrar", exact: true }).click()
  await page.waitForURL(url => !url.pathname.startsWith("/login"))
}

async function api(page, method, path, body) {
  return page.evaluate(async ({ method, path, body }) => {
    const response = await fetch(`/api/${path}`, { method, headers: {
      Authorization: `Bearer ${localStorage.getItem("token")}`, "Content-Type": "application/json",
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const data = await response.json()
    if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(data)}`)
    return data
  }, { method, path, body })
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const adminContext = await browser.newContext()
  const playerContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const admin = await adminContext.newPage()
  const player = await playerContext.newPage()
  admin.setDefaultTimeout(20000)
  player.setDefaultTimeout(20000)
  try {
    await signIn(admin, process.env.ADMIN_EMAIL || "admin@example.com")
    await admin.getByRole("tab", { name: "Atividades", exact: true }).click()
    await admin.getByRole("tab", { name: "Jogos", exact: true }).click()
    await admin.getByRole("button", { name: "Criar questionário aberto", exact: true }).click()
    await admin.getByLabel("Título do jogo").fill(title)
    for (let index = 0; index < 2; index++) {
      await admin.getByRole("button", { name: "Adicionar pergunta", exact: true }).click()
      const question = admin.getByRole("region", { name: `Pergunta ${index + 1}`, exact: true })
      await question.getByLabel("Enunciado", { exact: true }).fill(index ? "Qual será o próximo passo?" : "Como você faria a abordagem?")
      await question.getByLabel("Peso da pergunta (1 a 100)").fill(index ? "1" : "2")
      await question.getByLabel("Orientação de correção", { exact: false }).fill(notes)
    }
    await admin.getByRole("button", { name: "Publicar versão", exact: true }).click()
    await admin.getByText("Versão 1 publicada. Já pode ser adicionada à trilha.", { exact: true }).waitFor()
    await admin.getByRole("button", { name: "Pré-visualizar", exact: true }).click()
    const preview = admin.getByRole("region", { name: "Prévia do jogo" })
    await preview.getByLabel("Resposta da pergunta 1", { exact: true }).fill("Resposta de teste")
    await preview.getByLabel("Resposta da pergunta 2", { exact: true }).fill("Próximo passo de teste")
    await preview.getByRole("button", { name: "Enviar respostas da prévia" }).click()
    await preview.getByRole("status").filter({ hasText: "Respostas enviadas" }).waitFor()
    await preview.getByRole("button", { name: "Voltar ao editor", exact: true }).click()
    assert.equal(await admin.getByLabel("Título do jogo").inputValue(), title)
    await admin.getByRole("button", { name: "Fechar editor", exact: true }).click()

    const otherGame = await api(admin, "POST", "games", { title: `${title} Vendas`, eixo: "vendas", format: "open_response" })
    await admin.reload()
    await admin.getByRole("tab", { name: "Jogos", exact: true }).click()
    await admin.getByRole("region", { name: "Jogos — Trainee (Geral)", exact: true }).getByText(title, { exact: true }).waitFor()
    await admin.getByRole("region", { name: "Jogos — Vendas", exact: true }).getByText(otherGame.title, { exact: true }).waitFor()
    await admin.getByLabel("Filtrar jogos por eixo").selectOption("vendas")
    assert.equal(await admin.getByRole("region", { name: "Jogos — Trainee (Geral)", exact: true }).count(), 0)

    const support = await api(admin, "POST", "materials", { name: "Guia trainee", type: "trainee", eixo: "trainee", text: "Guia para responder", documents: [], videos: ["https://example.com/video"] })
    const shared = await api(admin, "POST", "materials", { name: "Guia compartilhado", type: "trainee", eixo: "all", text: "Conteúdo compartilhado", documents: [{ name: "Documento de apoio", url: "https://example.com/doc" }], videos: [] })
    await api(admin, "POST", "nodes", { name: "Leitura compartilhada", type: "material", eixo: "trainee", reference_id: shared.id, is_released: true, is_required: false })
    await admin.getByRole("tab", { name: /Trilha/ }).click()
    await admin.getByRole("button", { name: "Novo Nó", exact: true }).click()
    await admin.locator("select").filter({ has: admin.locator('option[value="game"]') }).selectOption("game")
    await admin.getByPlaceholder("Se vazio, usa o título do conteúdo selecionado").fill(nodeName)
    const selectGame = admin.getByLabel("Jogo publicado", { exact: true })
    const revisionId = await selectGame.locator("option").filter({ hasText: title }).first().getAttribute("value")
    await selectGame.selectOption(revisionId)
    // Materials were created after the dashboard's first load; reload its data by
    // returning to the page before attaching the support material through the API.
    await admin.getByLabel("Liberar imediatamente").check()
    await admin.getByRole("button", { name: "Criar Nó", exact: true }).click()
    await admin.getByText(nodeName, { exact: true }).first().waitFor()
    const node = (await api(admin, "GET", "nodes")).find(item => item.name === nodeName)
    await api(admin, "PATCH", `nodes/${node.id}`, { reference_id: support.id })
    const nextNode = await api(admin, "POST", "nodes", { name: "Etapa posterior", type: "game", eixo: "trainee", game_revision_id: revisionId, is_released: true })
    console.log("PASS autoria, prévia, agrupamento dos jogos e vínculo com a trilha")

    await signIn(player, process.env.TRAINEE_EMAIL || "trainee@example.com")
    await player.getByRole("tab", { name: "Biblioteca", exact: true }).click()
    await player.getByRole("region", { name: "Materiais — Trainee (Geral)", exact: true }).getByText(support.name, { exact: true }).waitFor()
    await player.getByRole("region", { name: "Materiais — Todos os eixos", exact: true }).getByText(shared.name, { exact: true }).waitFor()
    await player.getByRole("button", { name: "Com vídeo", exact: true }).click()
    await player.getByRole("region", { name: "Materiais — Todos os eixos", exact: true }).waitFor({ state: "hidden" })
    await player.getByRole("button", { name: "Todos os tipos", exact: true }).click()
    await player.getByRole("button", { name: "Com documento", exact: true }).click()
    await player.getByRole("region", { name: "Materiais — Trainee (Geral)", exact: true }).waitFor({ state: "hidden" })
    await player.goto(`${baseURL}/trilha/${node.id}/jogar`)
    await player.getByLabel("Resposta da pergunta 1", { exact: true }).fill("Vou ouvir a necessidade antes de propor uma solução.")
    await player.getByLabel("Resposta da pergunta 2", { exact: true }).fill("Registrar o combinado.")
    await player.reload()
    assert.equal(await player.getByLabel("Resposta da pergunta 2", { exact: true }).inputValue(), "Registrar o combinado.")
    assert.equal(await player.getByText(notes, { exact: true }).count(), 0)
    await player.getByRole("button", { name: "Enviar respostas para correção", exact: true }).click()
    await player.getByRole("heading", { name: "Aguardando correção", exact: true }).waitFor()
    await player.reload()
    await player.getByRole("heading", { name: "Aguardando correção", exact: true }).waitFor()
    assert.equal(await player.getByRole("textbox").count(), 0)
    const pendingNodes = await api(player, "GET", "nodes")
    assert.equal(pendingNodes.find(item => item.id === node.id).completed, false)
    assert.equal(pendingNodes.find(item => item.id === node.id).pending_review, true)
    assert.equal(pendingNodes.find(item => item.id === nextNode.id).unlocked, false)
    assert.ok(await player.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    console.log("PASS biblioteca por eixo/tipo, retomada da escrita, envio pendente e bloqueio da etapa seguinte no celular")

    await admin.getByRole("tab", { name: "Correções", exact: true }).click()
    await admin.getByRole("tab", { name: "Questionários abertos", exact: true }).click()
    const row = admin.getByRole("article", { name: "Questionário de Trainee", exact: true })
    await row.getByRole("button", { name: "Corrigir respostas", exact: true }).click()
    await row.getByText("Vou ouvir a necessidade antes de propor uma solução.", { exact: true }).waitFor()
    await row.getByLabel("Nota da pergunta 1 (0 a 10)", { exact: true }).fill("9")
    await row.getByLabel("Nota da pergunta 2 (0 a 10)", { exact: true }).fill("3")
    await row.getByLabel("Feedback da pergunta 1 (opcional)").fill("Boa abordagem.")
    await row.getByText("Nota final: 7.00 / 10", { exact: true }).waitFor()
    // Simulate a failed save and verify the authored correction is preserved.
    await admin.route("**/api/game-reviews/*/grade", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Falha temporária de teste" }) }))
    await row.getByRole("button", { name: "Salvar correção", exact: true }).click()
    await row.getByRole("alert").waitFor()
    assert.equal(await row.getByLabel("Nota da pergunta 1 (0 a 10)", { exact: true }).inputValue(), "9")
    await admin.unroute("**/api/game-reviews/*/grade")
    await row.getByRole("button", { name: "Salvar correção", exact: true }).click()
    await row.waitFor({ state: "hidden" })
    await player.getByRole("button", { name: "Atualizar correção", exact: true }).click()
    await player.getByText("Nota: 7.00 / 10", { exact: true }).waitFor()
    await player.getByText("Boa abordagem.", { exact: true }).waitFor()
    assert.equal(await player.getByText(notes, { exact: true }).count(), 0)
    const completedNodes = await api(player, "GET", "nodes")
    assert.equal(completedNodes.find(item => item.id === node.id).grade, 7)
    assert.equal(completedNodes.find(item => item.id === nextNode.id).unlocked, true)
    await player.reload()
    await player.getByText("Nota: 7.00 / 10", { exact: true }).waitFor()
    console.log("PASS correção ponderada, preservação após falha, feedback e atualização da trilha")

    await admin.getByLabel("Situação dos questionários").selectOption("graded")
    await row.getByText("Nota: 7.00 / 10", { exact: true }).waitFor()
    await admin.getByRole("tab", { name: "Dashboards", exact: true }).click()
    await admin.getByRole("img", { name: "Média da nota por pergunta", exact: true }).waitFor()
    await admin.getByText("Nota média", { exact: true }).waitFor()
    await player.getByRole("button", { name: "Repetir jogo", exact: true }).click()
    await player.getByLabel("Resposta da pergunta 1", { exact: true }).waitFor()
    assert.equal(await player.getByLabel("Resposta da pergunta 1", { exact: true }).inputValue(), "")
    console.log("PASS histórico de corrigidos, médias por pergunta e nova tentativa")
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
