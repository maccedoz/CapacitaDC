// Dashboards com a API real e um banco descartável (backend/tests/serve.py).
const assert = require("node:assert/strict")
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || "playwright")
const baseURL = process.env.BASE_URL || "http://127.0.0.1:3027"
const password = process.env.PASSWORD || "qa-test-password"

async function api(token, method, path, body) {
  const response = await fetch(baseURL + path, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json()
  assert.equal(response.status, 200, `${method} ${path}: ${JSON.stringify(data)}`)
  return data
}

async function login(email) {
  return api(null, "POST", "/api/auth/login", { email, password })
}

async function main() {
  const admin = await login(process.env.ADMIN_EMAIL || "admin@example.com")
  const member = await login(process.env.MEMBER_EMAIL || "membro@example.com")
  const suffix = Date.now()
  const title = `Jogo de indicadores ${suffix}`
  const game = await api(admin.access_token, "POST", "/api/games", {
    title, eixo: "vendas", format: "quiz", config: { questions: [
      { id: "q1", text: "Qual é a resposta?", selection: "single", options: [
        { id: "a", text: "Certa", is_correct: true }, { id: "b", text: "Errada", is_correct: false },
      ] },
      { id: "q2", text: "Selecione as duas corretas", selection: "multiple", options: [
        { id: "c", text: "Primeira", is_correct: true }, { id: "d", text: "Segunda", is_correct: true },
        { id: "e", text: "Errada", is_correct: false },
      ] },
    ] },
  })
  const published = await api(admin.access_token, "POST", `/api/games/${game.id}/publish`, {})
  const node = await api(admin.access_token, "POST", "/api/nodes", {
    name: title, type: "game", eixo: "vendas", game_revision_id: published.published_revision.id,
    is_released: true, is_required: false, weight: 0,
  })
  for (const correct of [false, true]) {
    const attempt = await api(member.access_token, "POST", `/api/nodes/${node.id}/attempts`, {})
    await api(member.access_token, "POST", `/api/game-attempts/${attempt.id}/complete`, {
      answers: [{ question_id: "q1", option_ids: [correct ? "a" : "b"] },
        { question_id: "q2", option_ids: correct ? ["c", "d"] : ["c"] }],
    })
  }
  const stats = await api(admin.access_token, "GET", `/api/dashboard/games/${node.id}`)
  assert.equal(stats.revisions[0].attempts, 1)
  assert.equal(stats.revisions[0].average_first_grade, 2.5)
  const browser = await chromium.launch()
  const errors = []
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: "America/Bahia" })
    page.on("pageerror", error => errors.push(error.message))
    await page.addInitScript(session => {
      localStorage.setItem("token", session.access_token)
      localStorage.setItem("currentUser", JSON.stringify(session.user))
    }, admin)
    await page.goto(`${baseURL}/?aba=dashboards`)
    await page.getByRole("heading", { name: "Dashboards", exact: true }).waitFor()
    await page.locator("#dashboard-trail").selectOption("vendas")
    await page.getByLabel("Jogo", { exact: true }).selectOption(node.id)
    await page.getByText("1 primeiras tentativas · média 2,5.", { exact: true }).waitFor()
    await page.getByRole("img", { name: "Taxa de acerto por questão", exact: true }).waitFor()
    const row = page.getByRole("row").filter({ hasText: "Selecione as duas corretas" })
    assert.match(await row.innerText(), /0%/)
    assert.match(await row.innerText(), /50%/)
    assert.match(await page.getByRole("row").filter({ hasText: title }).last().innerText(), /10/)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: "/tmp/capacita-dashboards-dark.png", fullPage: true })
    await page.getByRole("button", { name: "Usar tema claro" }).click()
    await page.locator("html.light").waitFor()
    await page.screenshot({ path: "/tmp/capacita-dashboards-light.png", fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Dashboard não deve criar rolagem horizontal na página")
    await page.screenshot({ path: "/tmp/capacita-dashboards-mobile.png", fullPage: true })
    assert.deepEqual(errors, [])
    console.log("PASS dashboards: média da melhor nota, primeira tentativa, acerto parcial, gráficos em dois temas e mobile")

    const manager = await login("gerente-vendas@example.com")
    const context = await browser.newContext()
    await context.addInitScript(session => {
      localStorage.setItem("token", session.access_token)
      localStorage.setItem("currentUser", JSON.stringify(session.user))
    }, manager)
    const managed = await context.newPage()
    await managed.goto(`${baseURL}/?aba=dashboards`)
    await managed.locator("#dashboard-trail").waitFor()
    await managed.waitForFunction(() => document.querySelector("#dashboard-trail")?.options.length === 2)
    assert.deepEqual(await managed.locator("#dashboard-trail option").evaluateAll(options => options.map(option => option.value).sort()), ["trainee", "vendas"])
    await context.close()
    console.log("PASS dashboards: gerente só seleciona seu eixo e PlugInfo")
  } finally {
    await browser.close()
    await api(admin.access_token, "DELETE", `/api/nodes/${node.id}`)
    await api(admin.access_token, "DELETE", `/api/games/${game.id}`)
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
