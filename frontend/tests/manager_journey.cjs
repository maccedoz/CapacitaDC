// Browser journey over the real API: the admin names a manager, a manager runs
// their own axis and PlugInfo (trainees) and is refused elsewhere, a member reads only reached materials
// with clickable links, and a role change reaches an open session. Needs the
// disposable server from docs/TESTES.md (it seeds gerente-<eixo> and membro-<eixo>),
// started fresh: the trail is sequential, so steps left by earlier runs lock new ones.
//
//   BASE_URL=http://127.0.0.1:3017 PASSWORD=qa-test-password node frontend/tests/manager_journey.cjs
const assert = require("node:assert/strict")

let playwright
if (process.env.PLAYWRIGHT_PACKAGE) {
  playwright = require(process.env.PLAYWRIGHT_PACKAGE)
} else {
  try {
    playwright = require("playwright")
  } catch {
    throw new Error("Instale playwright no frontend ou defina PLAYWRIGHT_PACKAGE; veja docs/TESTES.md")
  }
}

const baseURL = process.env.BASE_URL || "http://127.0.0.1:3000"
const password = process.env.PASSWORD || "qa-test-password"
const run = process.env.RUN_ID || Date.now().toString(36).slice(-5)

async function api(path, token, method = "GET", body) {
  const response = await fetch(`${baseURL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

async function token(email) {
  const { status, body } = await api("/api/auth/login", null, "POST", { email, password })
  assert.equal(status, 200, `login de ${email}`)
  return body.access_token
}

async function material(admin, name, eixo, text, released = true) {
  const created = await api("/api/materials", admin, "POST", { name, type: "membro", eixo, text })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const node = await api("/api/nodes", admin, "POST", { type: "material", eixo, reference_id: created.body.id, is_released: released })
  assert.equal(node.status, 200, JSON.stringify(node.body))
  return created.body
}

async function signIn(browser, email) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${baseURL}/login`)
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByLabel("Senha", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Entrar", exact: true }).click()
  await page.waitForURL(url => !url.pathname.startsWith("/login"))
  return { page, context }
}

async function adminNamesManager(browser, admin) {
  const { page, context } = await signIn(browser, "admin@example.com")
  const email = `gerente-novo-${run}@example.com`
  await page.getByRole("button", { name: "Cadastrar Membro", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Nome", { exact: true }).fill(`Gerente novo ${run}`)
  await dialog.getByLabel("Email", { exact: true }).fill(email)
  await dialog.getByLabel("Senha", { exact: true }).fill(password)
  await dialog.getByRole("combobox").filter({ hasText: "Selecione o cargo" }).click()
  await page.getByRole("option", { name: "Gerente de eixo", exact: true }).click()
  await dialog.getByRole("button", { name: "Cadastrar", exact: true }).click()
  await dialog.getByText("Escolha o eixo que o gerente vai administrar").waitFor()
  await dialog.getByRole("combobox").filter({ hasText: "Selecione o eixo" }).click()
  await page.getByRole("option", { name: "Experiência do Consumidor", exact: true }).click()
  await dialog.getByRole("button", { name: "Cadastrar", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  const { body: users } = await api("/api/users", admin)
  const created = users.find(user => user.email === email)
  assert.deepEqual([created?.type, created?.eixo, created?.cargo], ["gerente", "experiencia", "Gerente"])
  await context.close()
  console.log("PASS admin: nomeia gerente pela interface, com eixo obrigatório")
}

async function managerRunsOwnAxis(browser, admin, sales, connections) {
  const { page, context } = await signIn(browser, "gerente-conexoes@example.com")
  assert.equal(new URL(page.url()).pathname, "/")
  await page.getByRole("heading", { name: "Gerente — Conexões" }).waitFor()
  await page.getByText("Membro-conexoes", { exact: true }).waitFor()
  assert.equal(await page.getByText("Membro-vendas", { exact: true }).count(), 0)
  await page.getByRole("heading", { name: "Trainees de Comercial" }).waitFor()
  console.log("PASS gerente: painel identifica o eixo e lista só os membros dele e os trainees")

  await page.getByRole("tab", { name: /Materiais/ }).click()
  await page.getByText(connections.name, { exact: true }).waitFor()
  assert.equal(await page.getByText(sales.name, { exact: true }).count(), 0)
  await page.getByRole("button", { name: "Adicionar Conteúdo", exact: true }).click()
  assert.equal(await page.locator("#content-axis-locked").inputValue(), "Conexões")
  const name = `Material do gerente ${run}`
  await page.getByLabel("Nome do Conteúdo", { exact: true }).fill(name)
  await page.locator("#content-text").fill("Assista em https://example.com/aula.\nDepois responda.")
  const preview = page.getByRole("link", { name: /https:\/\/example\.com\/aula/ })
  await preview.waitFor()
  assert.equal(await preview.getAttribute("href"), "https://example.com/aula")
  assert.equal(await preview.getAttribute("target"), "_blank")
  assert.equal(await preview.getAttribute("rel"), "noopener noreferrer")
  await page.getByRole("button", { name: "Salvar Alterações", exact: true }).click()
  await page.getByText(name, { exact: true }).waitFor()
  const { body: saved } = await api("/api/materials", admin)
  assert.equal(saved.find(item => item.name === name)?.eixo, "conexoes")
  console.log("PASS gerente: cria material travado no eixo, com link clicável na pré-visualização")

  const pluginName = `Material PlugInfo ${run}`
  await page.getByRole("button", { name: "Adicionar Conteúdo", exact: true }).click()
  await page.getByLabel("Tipo de Conteúdo").click()
  await page.getByRole("option", { name: "Trainee (PlugInfo)", exact: true }).click()
  assert.equal(await page.locator("#content-axis-locked").inputValue(), "Trainee")
  await page.getByLabel("Nome do Conteúdo", { exact: true }).fill(pluginName)
  await page.getByRole("button", { name: "Salvar Alterações", exact: true }).click()
  await page.getByText(pluginName, { exact: true }).waitFor()
  const { body: withPlugin } = await api("/api/materials", admin)
  const plugin = withPlugin.find(item => item.name === pluginName)
  assert.deepEqual([plugin?.type, plugin?.eixo], ["trainee", "trainee"])
  console.log("PASS gerente: também cria material do PlugInfo (trainees)")

  await page.getByRole("tab", { name: /Trilha/ }).click()
  await page.getByRole("heading", { name: "Conexões", exact: true }).waitFor()
  assert.equal(await page.getByRole("heading", { name: "Vendas", exact: true }).count(), 0)

  const manager = await page.evaluate(() => localStorage.getItem("token"))
  for (const [method, path, body] of [
    ["PUT", `/api/materials/${sales.id}`, { name: "Invadido", type: "membro", eixo: "conexoes" }],
    ["GET", "/api/users/membro-vendas/profile"],
    ["PUT", "/api/users/membro-conexoes", { type: "gerente" }],
    ["POST", "/api/users", { name: "X", email: `x-${run}@example.com`, cargo: "gerente", type: "gerente", eixo: "conexoes", password: "qa-test-password" }],
  ]) {
    assert.equal((await api(path, manager, method, body)).status, 403, `${method} ${path}`)
  }
  console.log("PASS gerente: API recusa outros eixos, promoções e novos gerentes mesmo por URL direta")
  return { page, context, name }
}

async function roleChangeReachesOpenSession(admin, session) {
  const { page, context, name } = session
  const { body: users } = await api("/api/users", admin)
  const manager = users.find(user => user.email === "gerente-conexoes@example.com")
  assert.equal((await api(`/api/users/${manager.id}`, admin, "PUT", { eixo: "vendas" })).status, 200)
  // A próxima ação do gerente é recusada; a sessão é conferida e o painel troca de eixo.
  await page.getByRole("tab", { name: /Materiais/ }).click()
  await page.getByText(name, { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-2xl')]")
    .getByRole("button", { name: "Editar" }).click()
  await page.getByRole("button", { name: "Salvar Alterações", exact: true }).click()
  await page.getByRole("heading", { name: "Gerente — Vendas" }).waitFor()
  assert.equal(await page.getByText(name, { exact: true }).count(), 0)
  await context.close()
  assert.equal((await api(`/api/users/${manager.id}`, admin, "PUT", { eixo: "conexoes" })).status, 200)
  console.log("PASS sessão: mudança de eixo pelo administrador vale para a sessão aberta")
}

async function memberLibraryShowsReachedMaterials(browser, connections, locked) {
  const { page, context } = await signIn(browser, "membro-conexoes@example.com")
  assert.equal(new URL(page.url()).pathname, "/membros")
  await page.getByRole("tab", { name: /Biblioteca/ }).click()
  await page.getByText(connections.name, { exact: true }).waitFor()
  assert.equal(await page.getByText(locked.name, { exact: true }).count(), 0)
  // O cartão é o contêiner mais interno com o título e o próprio botão "Ver mais".
  const card = page.locator("div")
    .filter({ has: page.getByText(connections.name, { exact: true }) })
    .filter({ has: page.getByRole("button", { name: /Ver mais/ }) }).last()
  await card.getByRole("button", { name: /Ver mais/ }).click()
  const link = page.getByRole("link", { name: /https:\/\/example\.com\/guia/ })
  await link.waitFor()
  assert.equal(await link.getAttribute("href"), "https://example.com/guia")
  await context.close()
  console.log("PASS membro: biblioteca mostra só materiais alcançados, com links clicáveis")
}

;(async () => {
  const admin = await token("admin@example.com")
  const sales = await material(admin, `Vendas ${run}`, "vendas", "Conteúdo de vendas")
  const connections = await material(admin, `Conexões ${run}`, "conexoes", "Leia https://example.com/guia.")
  // Liberada, mas depende da etapa anterior ainda não concluída.
  const locked = await material(admin, `Conexões bloqueado ${run}`, "conexoes", "Ainda não")
  const browser = await playwright.chromium.launch()
  try {
    await adminNamesManager(browser, admin)
    const session = await managerRunsOwnAxis(browser, admin, sales, connections)
    await memberLibraryShowsReachedMaterials(browser, connections, locked)
    await roleChangeReachesOpenSession(admin, session)
  } finally {
    await browser.close()
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
