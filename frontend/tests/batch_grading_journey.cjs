// Correção em lote e atalhos de teclado na fila de correções.
// Precisa de um banco descartável e vazio (backend/tests/serve.py) e do servidor de desenvolvimento.
//
//   BASE_URL=http://127.0.0.1:3017 ADMIN_EMAIL=admin@example.com TRAINEE_EMAIL=trainee@example.com \
//     PASSWORD=qa-test-password node frontend/tests/batch_grading_journey.cjs
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
const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com"
const traineeEmail = process.env.TRAINEE_EMAIL || "trainee@example.com"
const password = process.env.PASSWORD || "qa-test-password"
const titles = ["Entrega A", "Entrega B", "Entrega C", "Entrega D"]

async function api(token, method, path, body) {
  const response = await fetch(`${baseURL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  assert.ok(response.ok, `${method} ${path} -> ${response.status} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

const login = async email => (await api(null, "POST", "/api/auth/login", { email, password })).access_token

async function seed() {
  const admin = await login(adminEmail)
  const trainee = await login(traineeEmail)
  for (const title of titles) {
    // Etapas opcionais: não bloqueiam a seguinte na trilha sequencial.
    const activity = await api(admin, "POST", "/api/activities", { title, eixo: "trainee", accepts_file: false, is_required: false, weight: 0 })
    const node = await api(admin, "POST", "/api/nodes", { name: `Etapa ${title}`, type: "activity", eixo: "trainee", activity_id: activity.id, is_released: true })
    await api(trainee, "POST", `/api/activities/${activity.id}/submit`, { node_id: node.id, comment: `Texto da ${title}` })
  }
  return admin
}

const activeRowTitle = page => page.evaluate(() => {
  const element = document.activeElement
  const row = element && element.closest("[data-submission-id]")
  return row ? { label: element.getAttribute("aria-label"), text: row.textContent } : null
})

async function main() {
  const admin = await seed()
  console.log("PASS preparo: quatro entregas pendentes")
  const browser = await playwright.chromium.launch()
  const page = await browser.newPage()
  try {
    await page.goto(`${baseURL}/login`)
    await page.getByLabel("Email", { exact: true }).fill(adminEmail)
    await page.getByLabel("Senha", { exact: true }).fill(password)
    await page.getByRole("button", { name: "Entrar", exact: true }).click()
    await page.waitForURL(url => !url.pathname.startsWith("/login"))
    await page.goto(`${baseURL}/?aba=correcoes`)
    const row = title => page.locator("[data-submission-id]").filter({ hasText: title })
    for (const title of titles) await row(title).waitFor()
    const order = await page.locator("[data-submission-id]").evaluateAll(rows => rows.map(r => r.textContent))
    const titleAt = index => titles.find(title => order[index].includes(title))

    // Enter salva e leva o foco para a próxima entrega, sem recarregar a fila.
    const first = titleAt(0), second = titleAt(1)
    await row(second).getByLabel("Feedback").fill("rascunho que não pode sumir")
    await row(first).getByLabel("Nota de 0 a 10").fill("7")
    await row(first).getByLabel("Nota de 0 a 10").press("Enter")
    await row(first).waitFor({ state: "detached" })
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Nota de 0 a 10")
    let focused = await activeRowTitle(page)
    assert.ok(focused.text.includes(second), "o foco não foi para a próxima entrega")
    assert.equal(await row(second).getByLabel("Feedback").inputValue(), "rascunho que não pode sumir")
    console.log("PASS atalhos: Enter salva, a entrega sai da fila e o foco vai para a próxima, sem perder rascunhos")

    // J/K navegam; F vai para o feedback; Ctrl+Enter salva de lá.
    await page.keyboard.press("j")
    focused = await activeRowTitle(page)
    assert.ok(focused.text.includes(titleAt(2)), "J não foi para a próxima")
    await page.keyboard.press("k")
    focused = await activeRowTitle(page)
    assert.ok(focused.text.includes(second), "K não voltou")
    await page.keyboard.type("8")
    await page.keyboard.press("f")
    focused = await activeRowTitle(page)
    assert.equal(focused.label, "Feedback")
    await page.keyboard.press("Control+Enter")
    await row(second).waitFor({ state: "detached" })
    console.log("PASS atalhos: J/K navegam, F vai para o feedback e Ctrl+Enter salva")

    // ? mostra a lista de atalhos.
    await page.keyboard.press("?")
    await page.getByRole("dialog", { name: "Atalhos da fila de correções" }).waitFor()
    await page.keyboard.press("Escape")

    // Lote: X marca a entrega com o foco; a outra pela caixa de seleção.
    const third = titleAt(2), fourth = titleAt(3)
    await row(third).getByLabel("Nota de 0 a 10").focus()
    await page.keyboard.press("x")
    await row(fourth).getByRole("checkbox").click()
    const bar = page.getByRole("region", { name: "Correção em lote" })
    await bar.getByText("2 selecionadas", { exact: true }).waitFor()
    await bar.getByLabel("Nota do lote").fill("9")
    await bar.getByLabel("Feedback do lote (opcional)").fill("Bom trabalho")
    await bar.getByRole("button", { name: "Dar nota às 2 selecionadas" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Corrigir" }).click()
    await page.getByText("2 entregas corrigidas com nota 9.0.").waitFor()
    await page.getByText("Nenhum envio neste filtro").waitFor()
    console.log("PASS lote: duas entregas corrigidas de uma vez, com confirmação")

    await page.getByLabel("Situação").selectOption("graded")
    await row(third).getByText(/corrigida por Admin/).waitFor()
    const graded = await api(admin, "GET", "/api/submissions?status=graded")
    const byTitle = Object.fromEntries(graded.map(item => [item.activity_title, item]))
    assert.deepEqual(titles.map(title => byTitle[title].grade), titles.map(title => ({ [first]: 7, [second]: 8, [third]: 9, [fourth]: 9 })[title]))
    assert.equal(byTitle[third].feedback, "Bom trabalho")
    console.log("PASS corrigidas: notas certas e \"corrigida por\" na fila")
  } finally {
    await browser.close()
  }
  console.log("Correção em lote e atalhos verificados no navegador.")
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
