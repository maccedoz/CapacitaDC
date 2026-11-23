// Run with a frontend server: BASE_URL=http://127.0.0.1:3017 node frontend/tests/node_release.cjs
// All API responses are intercepted; no application database is read or written.
const assert = require("node:assert/strict")

let playwright
if (process.env.PLAYWRIGHT_PACKAGE) {
  playwright = require(process.env.PLAYWRIGHT_PACKAGE)
} else {
  try { playwright = require("playwright") }
  catch { throw new Error("Instale playwright no frontend ou defina PLAYWRIGHT_PACKAGE; veja docs/TESTES.md") }
}

const baseURL = process.env.BASE_URL || "http://127.0.0.1:3000"
const now = new Date("2026-10-07T06:00:00.000Z")
const admin = { id: "release-admin", name: "Pessoa Teste", email: "release@example.test", type: "admin", cargo: "admin", pontos_acumulados: 0 }
const fulfill = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

async function fixture(browser, { timezoneId = "America/Bahia", naive = false, releasedAt = "2026-10-07T17:00:00.000Z" } = {}) {
  const context = await browser.newContext({ timezoneId, locale: "pt-BR" })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  await page.clock.install({ time: now })
  await page.clock.pauseAt(new Date(now.getTime() + 1000))
  const serialize = value => naive && value ? value.replace(/Z$/, "") : value
  const state = {
    node: { id: "release-node", name: "Etapa agendada", type: "game", eixo: "trainee", order_index: 0,
      is_released: true, released_at: serialize(releasedAt), released_by: admin.id,
      unlocked: false, completed: false, user_score: 0, questions: [] },
    getCount: 0, patches: [], failSave: false, failNextGet: false, nextGet: null, nextPatch: null,
  }
  await context.addInitScript(user => {
    localStorage.setItem("token", "release-test-token")
    localStorage.setItem("currentUser", JSON.stringify(user))
  }, admin)
  await context.route("**/api/**", async route => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === "/api/auth/me") return fulfill(route, 200, admin)
    if (pathname === "/api/nodes" && request.method() === "GET") {
      state.getCount++
      // Snapshot before waiting reproduces a GET sent before a later PATCH.
      const snapshot = { ...state.node }
      const held = state.nextGet
      state.nextGet = null
      if (held) {
        held.received.resolve(request)
        await held.resume.promise
      }
      if (state.failNextGet) {
        state.failNextGet = false
        return fulfill(route, 503, { detail: "Atualização temporariamente indisponível" })
      }
      return fulfill(route, 200, [snapshot])
    }
    if (pathname === "/api/nodes/release-node/release") {
      assert.equal(request.method(), "PATCH")
      const payload = request.postDataJSON()
      state.patches.push(payload)
      const held = state.nextPatch
      state.nextPatch = null
      if (held) {
        held.received.resolve(request)
        await held.resume.promise
      }
      if (state.failSave) return fulfill(route, 503, { detail: "Falha temporária ao salvar horário" })
      state.node = { ...state.node, ...payload, released_at: serialize(payload.released_at) }
      return fulfill(route, 200, state.node)
    }
    return fulfill(route, 200, [])
  })
  await page.goto(baseURL)
  await page.getByRole("tab", { name: /Trilha/ }).click()
  const card = page.locator('[data-slot="card"]').filter({ has: page.getByText("Etapa agendada", { exact: true }) })
  const input = card.locator('input[type="datetime-local"]')
  const save = card.getByRole("button", { name: /^(Salvar|Salvo|Salvando…|Salvando\.\.\.)$/ })
  await input.waitFor()

  function holdNext(kind) {
    const held = { received: deferred(), resume: deferred() }
    state[kind] = held
    return { received: held.received.promise, resume: () => held.resume.resolve() }
  }
  function responseFor(method) {
    return page.waitForResponse(response => response.request().method() === method
      && new URL(response.url()).pathname === (method === "GET" ? "/api/nodes" : "/api/nodes/release-node/release"))
  }
  async function processed(response) {
    await (await response).finished()
    // Allow React to apply the response with the browser clock still controlled.
    await page.clock.runFor(25)
  }
  async function saveCurrent() {
    const response = responseFor("PATCH")
    await save.click()
    await processed(response)
  }
  async function poll() {
    const response = responseFor("GET")
    await page.clock.runFor(60000)
    await processed(response)
  }
  return { page, context, card, input, save, state, holdNext, responseFor, processed, saveCurrent, poll }
}

async function checkTimezone(browser, timezoneId, naive) {
  const bahia = timezoneId === "America/Bahia"
  const start = bahia ? "2026-10-07T16:00:00.000Z" : "2026-10-07T07:30:00.000Z"
  const expected = bahia ? "2026-10-07T17:00:00.000Z" : "2026-10-07T08:30:00.000Z"
  const f = await fixture(browser, { timezoneId, naive, releasedAt: start })
  try {
    assert.equal(await f.input.inputValue(), "2026-10-07T13:00")
    await f.input.fill("2026-10-07T14:00")
    await f.saveCurrent()
    await f.card.getByRole("button", { name: "Salvo", exact: true }).waitFor()
    assert.deepEqual(f.state.patches, [{ is_released: true, released_at: expected }])
    assert.equal(await f.input.inputValue(), "2026-10-07T14:00")
    assert.match(await f.card.getByText(/^Agendado:/).textContent(), /07\/10\/2026.*14:00/)
    // A fresh page also reads the saved instant correctly, including legacy UTC without Z.
    await f.page.reload()
    await f.page.getByRole("tab", { name: /Trilha/ }).click()
    await f.input.waitFor()
    assert.equal(await f.input.inputValue(), "2026-10-07T14:00")
    assert.match(await f.card.getByText(/^Agendado:/).textContent(), /07\/10\/2026.*14:00/)
    console.log(`PASS fuso ${timezoneId}: 14h → UTC → 14h após salvar e recarregar (${naive ? "legado sem Z" : "UTC explícito"})`)
  } finally { await f.context.close() }
}

async function checkPollingDraft(browser) {
  const f = await fixture(browser)
  try {
    await f.input.fill("2026-10-07T16:00")
    const before = f.state.getCount
    await f.poll()
    assert.ok(f.state.getCount > before, "O teste deve executar a atualização automática real")
    assert.equal(await f.input.inputValue(), "2026-10-07T16:00")
    assert.match(await f.card.getByText(/^Agendado:/).textContent(), /14:00/)
    assert.equal(await f.save.textContent(), "Salvar")
    // Changes in the release switch are drafts too, even with its date field hidden.
    await f.card.getByRole("switch").click()
    await f.poll()
    assert.equal(await f.card.getByRole("switch").getAttribute("aria-checked"), "false")
    await f.saveCurrent()
    assert.deepEqual(f.state.patches.at(-1), { is_released: false, released_at: null })
    console.log("PASS atualização automática: preserva horário e liberação editados, inclusive após 60s")
  } finally { await f.context.close() }
}

async function checkOldGet(browser) {
  const f = await fixture(browser)
  try {
    const oldGet = f.holdNext("nextGet")
    await f.page.clock.runFor(60000)
    const oldRequest = await oldGet.received
    await f.input.fill("2026-10-07T16:00")
    await f.saveCurrent()
    await f.card.getByRole("button", { name: "Salvo", exact: true }).waitFor()
    oldGet.resume()
    await f.processed(oldRequest.response())
    assert.equal(await f.input.inputValue(), "2026-10-07T16:00")
    assert.match(await f.card.getByText(/^Agendado:/).textContent(), /16:00/)
    assert.equal(await f.save.textContent(), "Salvo")
    // Rejecting an old result must not stop subsequent scheduled refreshes.
    await f.poll()
    assert.equal(await f.input.inputValue(), "2026-10-07T16:00")
    console.log("PASS concorrência: GET antigo após PATCH não desfaz o salvamento; atualização continua")
  } finally { await f.context.close() }
}

async function checkEditDuringSave(browser) {
  const f = await fixture(browser)
  try {
    const patch = f.holdNext("nextPatch")
    const response = f.responseFor("PATCH")
    await f.input.fill("2026-10-07T16:00")
    await f.save.click()
    await patch.received
    assert.equal(await f.save.isDisabled(), true, "Impedir dois salvamentos concorrentes do mesmo nó")
    assert.equal(await f.input.isEnabled(), true, "A pessoa pode continuar editando enquanto salva")
    // Returning to the original value is still a new edit relative to the pending save.
    await f.input.fill("2026-10-07T14:00")
    await f.page.clock.runFor(60000)
    assert.equal(await f.input.inputValue(), "2026-10-07T14:00")
    patch.resume()
    await f.processed(response)
    await f.card.getByRole("button", { name: "Salvar", exact: true }).waitFor()
    assert.equal(await f.input.inputValue(), "2026-10-07T14:00")
    assert.match(await f.card.getByText(/^Agendado:/).textContent(), /16:00/)
    assert.equal(await f.save.isEnabled(), true)
    await f.saveCurrent()
    assert.deepEqual(f.state.patches, [
      { is_released: true, released_at: "2026-10-07T19:00:00.000Z" },
      { is_released: true, released_at: "2026-10-07T17:00:00.000Z" },
    ])
    console.log("PASS edição durante salvamento: resposta preserva nova edição e permite salvá-la depois")
  } finally { await f.context.close() }
}

async function checkFailedSave(browser) {
  const f = await fixture(browser)
  try {
    f.state.failSave = true
    await f.input.fill("2026-10-07T16:00")
    const dialog = f.page.waitForEvent("dialog").then(async alert => {
      assert.match(alert.message(), /O servidor está temporariamente indisponível/)
      await alert.accept()
    })
    const response = f.responseFor("PATCH")
    await f.save.click()
    await dialog
    await f.processed(response)
    assert.equal(await f.input.inputValue(), "2026-10-07T16:00")
    assert.equal(await f.save.isEnabled(), true)
    await f.poll()
    assert.equal(await f.input.inputValue(), "2026-10-07T16:00")
    f.state.failSave = false
    await f.saveCurrent()
    await f.card.getByRole("button", { name: "Salvo", exact: true }).waitFor()
    assert.equal(f.state.patches.length, 2)
    assert.equal(await f.input.inputValue(), "2026-10-07T16:00")
    console.log("PASS falha no salvamento: rascunho sobrevive ao erro e à atualização; nova tentativa salva")
  } finally { await f.context.close() }
}

async function checkReleaseBoundary(browser) {
  const f = await fixture(browser, { naive: true, releasedAt: "2026-10-07T06:00:03.000Z" })
  try {
    const badge = f.card.locator('[data-slot="badge"]')
    assert.equal((await badge.textContent()).trim(), "Agendado")
    const response = f.responseFor("GET")
    await f.page.clock.runFor(4000)
    await f.processed(response)
    assert.equal((await badge.textContent()).trim(), "Liberado")
    // The badge color must change with its text, using the same UTC interpretation.
    assert.match(await badge.getAttribute("class"), /emerald/)
    assert.doesNotMatch(await badge.getAttribute("class"), /amber/)
    console.log("PASS instante de liberação: status e cor mudam de agendado para liberado no fuso local")
  } finally { await f.context.close() }
}

async function checkPollingRecovery(browser) {
  const f = await fixture(browser, { releasedAt: "2026-10-07T06:00:03.000Z" })
  try {
    f.state.failNextGet = true
    const failedResponse = f.responseFor("GET")
    await f.page.clock.runFor(4000)
    assert.equal((await failedResponse).status(), 503)
    await f.processed(failedResponse)
    // Even though the release instant has passed, a failed read must be retried.
    f.state.node = { ...f.state.node, is_released: false, released_at: null }
    await f.poll()
    assert.equal(await f.card.getByRole("switch").getAttribute("aria-checked"), "false")
    assert.equal((await f.card.locator('[data-slot="badge"]').textContent()).trim(), "Bloqueado")
    console.log("PASS recuperação: falha na consulta no instante agendado é repetida e atualiza o estado")
  } finally { await f.context.close() }
}

async function checkSlowParticipantRead(browser) {
  const context = await browser.newContext({ timezoneId: "America/Bahia", locale: "pt-BR" })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  const user = { ...admin, id: "release-trainee", type: "trainee", cargo: "trainee", eixo: "trainee" }
  const started = deferred()
  const resume = deferred()
  let reads = 0
  let allowCurrent = false
  await page.clock.install({ time: now })
  await page.clock.pauseAt(new Date(now.getTime() + 1000))
  await context.addInitScript(user => {
    localStorage.setItem("token", "release-test-token")
    localStorage.setItem("currentUser", JSON.stringify(user))
  }, user)
  await context.route("**/api/**", async route => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === "/api/auth/me") return fulfill(route, 200, user)
    if (pathname !== "/api/nodes") return fulfill(route, 200, [])
    reads++
    // Development Strict Mode may issue multiple initial reads. Hold all of them.
    const unlocked = allowCurrent
    if (!unlocked) {
      started.resolve()
      await resume.promise
    }
    return fulfill(route, 200, [{ id: "slow-release", name: "Etapa com consulta demorada", type: "game", eixo: "trainee",
      is_released: true, released_at: "2026-10-07T06:00:03.000Z", unlocked,
      completed: false, order_index: 0, user_score: 0, questions: [] }])
  })
  const listResponse = () => page.waitForResponse(response => new URL(response.url()).pathname === "/api/nodes")
  try {
    const initialResponse = listResponse()
    await page.goto(`${baseURL}/trainees`)
    await started.promise
    // The server evaluated access before the release; the response arrives afterward.
    await page.clock.runFor(4000)
    allowCurrent = true
    resume.resolve()
    await (await initialResponse).finished()
    await page.clock.runFor(25)
    const button = page.getByRole("button", { name: "Etapa com consulta demorada", exact: true })
    await button.waitFor()
    assert.equal(await button.isDisabled(), true)
    const priorReads = reads
    const nextResponse = listResponse()
    await page.clock.runFor(1500)
    await (await nextResponse).finished()
    await page.clock.runFor(25)
    assert.ok(reads > priorReads)
    assert.equal(await button.isEnabled(), true)
    console.log("PASS participante: consulta que atravessa a liberação é refeita e desbloqueia a etapa")
  } finally { await context.close() }
}

async function checkActivityDeadline(browser, { slow = false, fail = false } = {}) {
  const context = await browser.newContext({ timezoneId: "America/Bahia", locale: "pt-BR" })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  const user = { ...admin, id: "deadline-trainee", type: "trainee", cargo: "trainee", eixo: "trainee" }
  const deadline = new Date(now.getTime() + 3000)
  const started = deferred(), resume = deferred()
  let failNext = false
  let contentAvailable = false
  await page.clock.install({ time: now })
  await page.clock.pauseAt(new Date(now.getTime() + 1000))
  await context.addInitScript(user => {
    localStorage.setItem("token", "deadline-test-token")
    localStorage.setItem("currentUser", JSON.stringify(user))
  }, user)
  await context.route("**/api/**", async route => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === "/api/auth/me") return fulfill(route, 200, user)
    if (pathname === "/api/activities") return fulfill(route, 200, contentAvailable ? [{
      id: "next-activity", title: "Atividade liberada após prazo", eixo: "trainee", effective_open: true,
      accepts_file: false, is_open: true, weight: 1, is_required: true, allow_retry: true,
    }] : [])
    if (pathname === "/api/materials") return fulfill(route, 200, contentAvailable ? [{
      id: "next-material", name: "Material liberado após prazo", type: "trainee", eixo: "trainee",
      text: "Material da próxima etapa", documents: [], videos: [],
    }] : [])
    if (pathname !== "/api/nodes") return fulfill(route, 200, [])
    if (failNext) {
      failNext = false
      return fulfill(route, 503, { detail: "Falha temporária no prazo" })
    }
    const expired = await page.evaluate(instant => Date.now() >= instant, deadline.getTime())
    if (slow && !expired) { started.resolve(); await resume.promise }
    contentAvailable = expired
    const base = { type: "activity", eixo: "trainee", is_released: true, released_at: null,
      completed: false, user_score: 0, questions: [] }
    return fulfill(route, 200, [
      { ...base, id: "missed", name: "Atividade pendente", order_index: 0, unlocked: true,
        activity_id: "missed-activity", deadline: deadline.toISOString(), deadline_expired: expired },
      { ...base, id: "next", name: "Próxima etapa", order_index: 1, unlocked: expired,
        activity_id: "next-activity", effective_prerequisite_id: "missed", deadline: null },
    ])
  })
  const listResponse = () => page.waitForResponse(response => new URL(response.url()).pathname === "/api/nodes")
  try {
    const initialResponse = listResponse()
    await page.goto(`${baseURL}/trainees`)
    if (slow) {
      await started.promise
      await page.clock.runFor(4000)
      resume.resolve()
    }
    await (await initialResponse).finished()
    await page.clock.runFor(25)
    const next = page.getByRole("button", { name: "Próxima etapa", exact: true })
    await next.waitFor()
    assert.equal(await next.isDisabled(), true)
    failNext = fail
    const updated = listResponse()
    await page.clock.runFor(slow ? 1500 : 4000)
    await (await updated).finished()
    await page.clock.runFor(25)
    if (fail) {
      assert.equal(await next.isDisabled(), true)
      const retried = listResponse()
      await page.clock.runFor(60000)
      await (await retried).finished()
      await page.clock.runFor(25)
    }
    assert.equal(await next.isEnabled(), true)
    await page.getByText("Prazo encerrado · não entregue", { exact: true }).waitFor()
    await page.getByRole("tab", { name: /Atividades/ }).click()
    await page.getByText("Atividade liberada após prazo", { exact: true }).waitFor()
    await page.getByRole("tab", { name: /Biblioteca/ }).click()
    await page.getByText("Material liberado após prazo", { exact: true }).waitFor()
    console.log(`PASS prazo de atividade: avanço e conteúdo atualizam sem entrega${slow ? ", consulta demorada" : fail ? ", recuperação após falha" : ""}`)
  } finally { resume.resolve(); await context.close() }
}

async function main() {
  const browser = await playwright.chromium.launch({ headless: true })
  try {
    for (const timezone of ["America/Bahia", "Asia/Kolkata"]) {
      for (const naive of [false, true]) await checkTimezone(browser, timezone, naive)
    }
    await checkPollingDraft(browser)
    await checkOldGet(browser)
    await checkEditDuringSave(browser)
    await checkFailedSave(browser)
    await checkReleaseBoundary(browser)
    await checkPollingRecovery(browser)
    await checkSlowParticipantRead(browser)
    await checkActivityDeadline(browser)
    await checkActivityDeadline(browser, { slow: true })
    await checkActivityDeadline(browser, { fail: true })
    console.log("14 cenários de agendamento e avanço por prazo passaram.")
  } finally { await browser.close() }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
