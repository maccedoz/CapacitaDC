// Jornada de Meu perfil, do aviso de troca de senha no primeiro acesso e das
// sugestões dos trainees. Usa a API descartável de backend/tests/serve.py, com a
// conta primeiro-acesso@example.com (a única que começa vendo o aviso).
//
//   BASE_URL=http://127.0.0.1:3017 PASSWORD=qa-test-password node frontend/tests/profile_journey.cjs
const assert = require("node:assert/strict")
const path = require("node:path")
const os = require("node:os")
const fs = require("node:fs")

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
const firstAccess = "primeiro-acesso@example.com"
const newPassword = "senha-nova-123"

// PNG 1x1 válido, para o recorte em canvas no navegador.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")

async function signIn(page, email, secret = password) {
  await page.goto(`${baseURL}/login`)
  // O botão de tema muda de rótulo ao montar; aguarda os eventos do formulário.
  await page.getByRole("button", { name: /Usar tema (claro|escuro)/ }).waitFor()
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByLabel("Senha", { exact: true }).fill(secret)
  await page.getByRole("button", { name: "Entrar", exact: true }).click()
  await page.waitForURL(url => !url.pathname.startsWith("/login"))
}

async function signOut(page) {
  await page.getByRole("button", { name: "Menu do usuário" }).click()
  await page.getByRole("menuitem", { name: "Sair" }).click()
  await page.waitForURL(url => url.pathname.startsWith("/login"))
}

async function main() {
  const browser = await playwright.chromium.launch()
  const page = await browser.newPage()
  try {
    // 1. Primeiro acesso: o aviso aparece, "Agora não" encerra e ele não volta.
    await signIn(page, firstAccess)
    const prompt = page.getByRole("alertdialog")
    await prompt.getByText("Quer trocar sua senha?").waitFor()
    await prompt.getByRole("button", { name: "Agora não" }).click()
    await prompt.waitFor({ state: "detached" })
    await page.reload()
    await page.getByRole("button", { name: "Menu do usuário" }).waitFor()
    await page.waitForTimeout(1000)
    assert.equal(await page.getByRole("alertdialog").count(), 0, "o aviso voltou depois de dispensado")
    console.log("PASS primeiro acesso: aviso de troca de senha aparece uma vez e some ao dispensar")

    // 2. Meu perfil: nome, foto e senha.
    await page.getByRole("button", { name: "Menu do usuário" }).click()
    await page.getByRole("menuitem", { name: "Meu perfil" }).click()
    const dialog = page.getByRole("dialog", { name: "Meu perfil" })
    await dialog.getByLabel("Nome", { exact: true }).fill("Pessoa Renomeada")
    await dialog.getByRole("button", { name: "Salvar", exact: true }).click()
    await dialog.getByText("Nome salvo.").waitFor()

    const photo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "perfil-")), "foto.png")
    fs.writeFileSync(photo, PNG)
    await dialog.getByLabel("Escolher foto de perfil").setInputFiles(photo)
    await dialog.getByText("Foto atualizada.").waitFor()
    await dialog.locator("img[alt='Pessoa Renomeada']").waitFor()
    console.log("PASS perfil: nome salvo e foto enviada aparecem na hora")

    await dialog.getByLabel("Senha atual").fill("errada")
    await dialog.getByLabel("Nova senha", { exact: true }).fill(newPassword)
    await dialog.getByLabel("Confirmar nova senha").fill(newPassword)
    await dialog.getByRole("button", { name: "Trocar senha" }).click()
    await dialog.getByText("A senha atual não confere.").waitFor()
    await dialog.getByLabel("Senha atual").fill(password)
    await dialog.getByRole("button", { name: "Trocar senha" }).click()
    await dialog.getByText("Senha trocada.", { exact: false }).waitFor()
    await page.keyboard.press("Escape")
    // A sessão atual continua (recebeu um token novo).
    await page.reload()
    await page.getByRole("button", { name: "Menu do usuário" }).waitFor()
    assert.ok(await page.getByText("Pessoa Renomeada").first().isVisible())
    console.log("PASS senha: senha atual errada é recusada; a troca mantém esta sessão")

    // 3. Sugestão enviada pelo trainee.
    await page.getByRole("tab", { name: "Sugestões" }).click()
    await page.getByLabel("Sua sugestão").fill("Mais jogos de cenário, por favor")
    await page.getByRole("button", { name: "Enviar" }).click()
    await page.getByText("Sugestão enviada. Obrigado!").waitFor()
    await page.getByText("Mais jogos de cenário, por favor").waitFor()
    console.log("PASS sugestões: trainee envia e vê a própria sugestão")

    await signOut(page)
    await signIn(page, firstAccess, newPassword)
    console.log("PASS senha: a nova senha entra no login")
    await signOut(page)

    // 4. O admin recebe a sugestão, com contador de não lidas.
    await signIn(page, "admin@example.com")
    const tab = page.getByRole("tab", { name: /Sugestões/ })
    await tab.getByText("1", { exact: true }).waitFor()
    await tab.click()
    await page.waitForURL(url => url.search.includes("aba=sugestoes"))
    const card = page.locator("li", { hasText: "Mais jogos de cenário, por favor" })
    await card.getByText("Pessoa Renomeada").waitFor()
    await card.getByRole("button", { name: "Marcar como lida" }).click()
    await page.getByText("Nenhuma sugestão por ler.").waitFor()
    assert.equal(await tab.getByText("1", { exact: true }).count(), 0)
    await page.getByRole("button", { name: "Todas" }).click()
    await page.locator("li", { hasText: "Mais jogos de cenário, por favor" }).getByRole("button", { name: "Marcar como não lida" }).waitFor()
    console.log("PASS sugestões: admin lê com o nome de quem enviou e marca como lida")
  } finally {
    await browser.close()
  }
  console.log("Perfil, aviso de senha e sugestões verificados no navegador.")
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
