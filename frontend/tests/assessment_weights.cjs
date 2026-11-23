// Respostas da API simuladas; verifica o valor enviado ao salvar e ao reabrir.
const assert = require("node:assert/strict")
const playwright = require(process.env.PLAYWRIGHT_PACKAGE || "playwright")
const baseURL = process.env.BASE_URL || "http://127.0.0.1:3000"
const admin = { id: "weight-admin", name: "Teste Peso", email: "weight@example.test", type: "admin", cargo: "admin", pontos_acumulados: 0 }
const fulfill = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })

async function checkWeight(browser, mode, weight) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, locale: "pt-BR" })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  let activity = { id: "weight-activity", title: "Atividade com peso", eixo: "trainee", accepts_file: false,
    is_open: true, effective_open: true, submission_count: 0, weight: 1, allow_retry: true, is_required: true }
  let node = { id: "weight-game", name: "Jogo com peso", type: "game", eixo: "trainee", order_index: 0,
    is_released: true, released_at: null, completed: false, unlocked: true, user_score: 0, questions: [],
    weight: 1, allow_retry: true, is_required: true }
  let created = mode !== "create"
  const writes = []
  await context.addInitScript(user => {
    localStorage.setItem("token", "weight-test-token")
    localStorage.setItem("currentUser", JSON.stringify(user))
  }, admin)
  await context.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === "/api/auth/me") return fulfill(route, admin)
    if (path === "/api/activities" && request.method() === "GET") return fulfill(route, created ? [activity] : [])
    if ((path === "/api/activities" && request.method() === "POST")
        || (path === `/api/activities/${activity.id}` && request.method() === "PATCH")) {
      const payload = request.postDataJSON()
      writes.push(payload)
      activity = { ...activity, ...payload }
      created = true
      return fulfill(route, activity)
    }
    if (path === "/api/nodes" && request.method() === "GET") return fulfill(route, mode === "game" ? [node] : [])
    if (path === `/api/nodes/${node.id}` && request.method() === "PATCH") {
      const payload = request.postDataJSON()
      writes.push(payload)
      node = { ...node, ...payload }
      return fulfill(route, node)
    }
    return fulfill(route, [])
  })
  const openEditor = async () => {
    if (mode === "game") {
      await page.getByRole("tab", { name: /Trilha/ }).click()
      await page.getByRole("button", { name: "Editar nó", exact: true }).click()
    } else {
      await page.getByRole("tab", { name: "Atividades", exact: true }).click()
      if (mode === "create" && !created) {
        await page.getByRole("button", { name: "Nova Atividade", exact: true }).click()
        await page.getByPlaceholder("Ex: Relatório de Prospecção").fill(activity.title)
      } else await page.getByRole("button", { name: "Editar", exact: true }).click()
    }
  }
  try {
    await page.goto(baseURL)
    await openEditor()
    const field = page.getByLabel("Peso da nota", { exact: true })
    await field.fill(String(weight))
    // Rolar até o botão Salvar não pode alterar silenciosamente um peso decimal.
    for (let i = 0; i < 3; i++) {
      await field.focus()
      await field.hover()
      await page.mouse.wheel(0, 20)
      await page.waitForTimeout(100)
    }
    const saveName = mode === "game" ? "Salvar alterações" : mode === "create" ? "Criar Atividade" : "Salvar"
    const saved = page.waitForResponse(response => ["POST", "PATCH"].includes(response.request().method())
      && new URL(response.url()).pathname.startsWith(mode === "game" ? "/api/nodes/" : "/api/activities"))
    await page.getByRole("button", { name: saveName, exact: true }).click()
    await (await saved).finished()
    assert.equal(writes.at(-1).weight, weight, `${mode}: salvar deve manter o peso digitado`)
    await field.waitFor({ state: "detached" })
    await page.reload()
    await openEditor()
    assert.equal(await field.inputValue(), String(weight), `${mode}: reabrir deve manter o peso salvo`)
    console.log(`PASS ${mode}: peso ${weight} preservado ao rolar, salvar e reabrir`)
  } finally { await context.close() }
}

async function main() {
  const browser = await playwright.chromium.launch({ headless: true })
  try {
    for (const mode of ["create", "edit", "game"]) {
      for (const weight of [3, 2.7]) await checkWeight(browser, mode, weight)
    }
    console.log("6 cenários de peso passaram.")
  } finally { await browser.close() }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
