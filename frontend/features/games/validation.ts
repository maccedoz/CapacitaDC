import type { GameDraft } from "./types"

// Validation here guides authors and protects local preview; publication is validated again by the API.
export function publicationIssues(draft: GameDraft): string[] {
  const issues: string[] = []
  if (!draft.title.trim()) issues.push("Informe o título do jogo.")
  if (draft.format === "quiz") issues.push(...quizIssues(draft.config))
  else if (draft.format === "open_response") {
    if (!draft.config.questions.length) issues.push("Adicione pelo menos uma pergunta.")
    if (draft.config.questions.length > 100) issues.push("Use no máximo 100 perguntas.")
    draft.config.questions.forEach((question, index) => {
      if (!question.text.trim()) issues.push(`Pergunta ${index + 1}: informe o enunciado.`)
      if (!Number.isInteger(question.weight) || question.weight < 1 || question.weight > 100) issues.push(`Pergunta ${index + 1}: o peso deve ser um inteiro de 1 a 100.`)
    })
  }
  else if (draft.format === "scenario") issues.push(...scenarioIssues(draft.config))
  else if (draft.format === "matching") issues.push(...matchingIssues(draft.config))
  else if (draft.format === "ordering") issues.push(...orderingIssues(draft.config))
  else issues.push(...categorizationIssues(draft.config))
  return issues
}

type Config<F extends GameDraft["format"]> = Extract<GameDraft, { format: F }>["config"]

function quizIssues(config: Config<"quiz">): string[] {
  const issues: string[] = []
  if (!config.questions.length) issues.push("Adicione pelo menos uma pergunta.")
  config.questions.forEach((question, index) => {
    const label = `Pergunta ${index + 1}`
    if (!question.text.trim()) issues.push(`${label}: informe o enunciado.`)
    if (!Number.isInteger(question.weight) || question.weight < 1 || question.weight > 100) issues.push(`${label}: o peso deve ser um número inteiro de 1 a 100.`)
    if (question.options.length < 2) issues.push(`${label}: adicione pelo menos duas opções.`)
    if (question.options.some(option => !option.text.trim())) issues.push(`${label}: preencha todas as opções.`)
    const correct = question.options.filter(option => option.is_correct).length
    if (question.selection === "single" ? correct !== 1 : correct < 1) issues.push(`${label}: marque ${question.selection === "single" ? "exatamente uma resposta correta" : "pelo menos uma resposta correta"}.`)
  })
  return issues
}

function scenarioIssues(config: Config<"scenario">): string[] {
  const issues: string[] = []
  const { steps, start_step_id } = config
  const stepMap = new Map(steps.map(step => [step.id, step]))
  if (!steps.length) issues.push("Adicione pelo menos um passo.")
  if (!stepMap.has(start_step_id)) issues.push("Escolha o passo inicial.")
  steps.forEach((step, index) => {
    const label = `Passo ${index + 1}`
    if (!step.text.trim()) issues.push(`${label}: descreva a situação.`)
    if (step.options.length < 2) issues.push(`${label}: adicione pelo menos duas decisões.`)
    if (step.options.some(option => !option.text.trim())) issues.push(`${label}: preencha todas as decisões.`)
    if (step.options.some(option => !Number.isInteger(option.score) || option.score < 0 || option.score > 100)) issues.push(`${label}: a pontuação deve ser um número inteiro entre 0 e 100.`)
    if (step.options.some(option => option.next_step_id && !stepMap.has(option.next_step_id))) issues.push(`${label}: uma decisão aponta para um passo inexistente.`)
  })
  const visited = new Set<string>()
  const visiting = new Set<string>()
  let cycle = false
  const visit = (id: string) => {
    if (visiting.has(id)) { cycle = true; return }
    if (visited.has(id)) return
    visiting.add(id)
    stepMap.get(id)?.options.forEach(option => { if (option.next_step_id) visit(option.next_step_id) })
    visiting.delete(id)
    visited.add(id)
  }
  if (stepMap.has(start_step_id)) visit(start_step_id)
  if (cycle) issues.push("O cenário contém um ciclo. Cada caminho precisa chegar ao fim sem repetir passos.")
  if (steps.some(step => !visited.has(step.id))) issues.push("Há passos que não podem ser alcançados a partir do passo inicial.")
  if (steps.length && !steps.some(step => step.options.some(option => option.score > 0))) issues.push("Defina uma pontuação maior que zero para pelo menos uma decisão.")
  return issues
}

function matchingIssues(config: Config<"matching">): string[] {
  const issues: string[] = []
  if (config.pairs.length < 2) issues.push("Adicione pelo menos dois pares.")
  config.pairs.forEach((pair, index) => {
    if (!pair.left.trim() || !pair.right.trim()) issues.push(`Par ${index + 1}: preencha os dois lados da associação.`)
  })
  config.distractors.forEach((card, index) => {
    if (!card.right.trim()) issues.push(`Opção extra ${index + 1}: preencha o texto ou remova a opção.`)
  })
  const rights = [...config.pairs.map(pair => pair.right), ...config.distractors.map(card => card.right)]
    .map(text => text.trim().toLocaleLowerCase("pt-BR")).filter(Boolean)
  if (new Set(rights).size !== rights.length) issues.push("Cada correspondência precisa de um texto distinto para ter resposta única.")
  return issues
}

function orderingIssues(config: Config<"ordering">): string[] {
  const issues: string[] = []
  if (config.items.length < 2) issues.push("Adicione pelo menos dois itens para ordenar.")
  config.items.forEach((item, index) => {
    if (!item.text.trim()) issues.push(`Item ${index + 1}: informe o texto.`)
  })
  return issues
}

function categorizationIssues(config: Config<"categorization">): string[] {
  const issues: string[] = []
  if (config.categories.length < 2) issues.push("Adicione pelo menos duas categorias.")
  if (config.items.length < 2) issues.push("Adicione pelo menos dois itens para classificar.")
  config.categories.forEach((category, index) => {
    if (!category.text.trim()) issues.push(`Categoria ${index + 1}: informe o nome.`)
  })
  const known = new Set(config.categories.map(category => category.id))
  config.items.forEach((item, index) => {
    if (!item.text.trim()) issues.push(`Item ${index + 1}: informe o texto.`)
    if (!known.has(item.category_id)) issues.push(`Item ${index + 1}: escolha a categoria correta.`)
  })
  const used = new Set(config.items.map(item => item.category_id))
  if (config.categories.some(category => !used.has(category.id))) issues.push("Cada categoria precisa de pelo menos um item.")
  return issues
}
