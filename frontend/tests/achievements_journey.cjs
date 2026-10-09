// Conquistas com API e banco descartáveis: baseline silenciosa e aviso persistente.
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
const login = email => api(null, "POST", "/api/auth/login", { email, password })

async function main() {
  const admin = await login(process.env.ADMIN_EMAIL || "admin@example.com")
  const suffix = Date.now()
  const created = []
  let personId
  const browser = await chromium.launch()
  try {
    // Conta nova para a jornada continuar independente de outras jornadas.
    const person = await api(admin.access_token, "POST", "/api/users", {
      name: "Membro das conquistas", email: `conquistas-${suffix}@infojr.com.br`, password,
      type: "membro", cargo: "membro", eixo: "vendas",
    })
    const session = await login(person.email)
    personId = person.id
    await api(session.access_token, "POST", "/api/auth/me/password-prompt/dismiss", {})
    session.user.password_prompt_pending = false
    assert.deepEqual((await api(session.access_token, "GET", "/api/gamification")).new_achievements, [])
    for (const title of ["Jogo concluído", "Jogo ainda pendente"]) {
      const game = await api(admin.access_token, "POST", "/api/games", {
        title: `${title} ${suffix}`, eixo: "vendas", format: "quiz", config: { questions: [
          { id: "q", text: "Escolha a correta", options: [
            { id: "a", text: "Certa", is_correct: true }, { id: "b", text: "Errada", is_correct: false },
          ] },
        ] },
      })
      const published = await api(admin.access_token, "POST", `/api/games/${game.id}/publish`, {})
      const node = await api(admin.access_token, "POST", "/api/nodes", {
        name: game.title, type: "game", eixo: "vendas", game_revision_id: published.published_revision.id,
        is_released: true, is_required: false, weight: 0,
      })
      created.push({ game, node })
    }
    const attempt = await api(session.access_token, "POST", `/api/nodes/${created[0].node.id}/attempts`, {})
    await api(session.access_token, "POST", `/api/game-attempts/${attempt.id}/complete`, {
      answers: [{ question_id: "q", option_ids: ["a"] }],
    })
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "America/Bahia" })
    await context.addInitScript(session => {
      localStorage.setItem("token", session.access_token)
      localStorage.setItem("currentUser", JSON.stringify(session.user))
    }, session)
    const page = await context.newPage()
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    await page.goto(baseURL + "/membros")
    const popup = page.getByTestId("achievement-popup")
    await popup.waitFor()
    await popup.getByText("Hello, World!", { exact: true }).waitFor()
    await popup.getByText("Farmou Aura", { exact: true }).waitFor()
    assert.equal(await page.getByRole("dialog").count(), 1, "Avisos não podem empilhar janelas")
    await popup.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))))
    await page.screenshot({ path: "/tmp/capacita-achievements-popup.png", fullPage: true })
    let failFirstConfirmation = true
    await page.route("**/api/gamification/seen", async route => {
      if (failFirstConfirmation) {
        failFirstConfirmation = false
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Falha de teste" }) })
      } else await route.continue()
    })
    await popup.getByRole("button", { name: "Continuar", exact: true }).click()
    await popup.getByRole("alert").waitFor()
    await popup.getByRole("button", { name: "Continuar", exact: true }).click()
    await popup.waitFor({ state: "hidden" })
    await page.getByRole("tab", { name: "Conquistas", exact: true }).click()
    await page.locator('[data-achievement="all_trails"]').waitFor()
    assert.equal(await page.locator("[data-achievement]").count(), 10)
    await page.screenshot({ path: "/tmp/capacita-achievements.png", fullPage: true })
    await page.getByRole("button", { name: "Usar tema claro" }).click()
    await page.locator("html.light").waitFor()
    await page.screenshot({ path: "/tmp/capacita-achievements-light.png", fullPage: true })
    assert.deepEqual(errors, [])
    await context.close()

    // A confirmação vive no servidor: outro navegador também não recebe o aviso.
    const second = await browser.newContext()
    await second.addInitScript(session => {
      localStorage.setItem("token", session.access_token)
      localStorage.setItem("currentUser", JSON.stringify(session.user))
    }, session)
    const revisit = await second.newPage()
    await revisit.goto(baseURL + "/membros")
    await revisit.getByRole("tab", { name: "Conquistas", exact: true }).click()
    await revisit.locator('[data-achievement="all_trails"]').waitFor()
    assert.equal(await revisit.getByTestId("achievement-popup").count(), 0)
    assert.deepEqual((await api(session.access_token, "GET", "/api/gamification")).new_achievements, [])
    await second.close()
    console.log("PASS conquistas: dez regras exibidas, popup conjunto, confirmação com retry e persistência em outro navegador")
  } finally {
    await browser.close()
    for (const { node, game } of created.reverse()) {
      await api(admin.access_token, "DELETE", `/api/nodes/${node.id}`)
      await api(admin.access_token, "DELETE", `/api/games/${game.id}`)
    }
    if (personId) await api(admin.access_token, "DELETE", `/api/users/${personId}`)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
