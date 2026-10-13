import type {
  CategorizationConfig, CategorizedItem, Category, GameDraft, GameFormat, MatchingCard,
  OrderingItem, QuizQuestion, ScenarioStep,
} from "./types"

export const gameFormatLabels: Record<GameFormat, string> = {
  quiz: "Questionário com opções",
  open_response: "Questionário aberto",
  scenario: "Cenário situacional",
  matching: "Associação",
  ordering: "Ordenação",
  categorization: "Classificação",
}

export const gameFormatSummaries: Record<GameFormat, string> = {
  quiz: "Perguntas de escolha única ou múltipla, com pesos, gabarito e explicações.",
  open_response: "Perguntas com respostas em texto, avaliadas pela gestão com nota e feedback.",
  scenario: "Situações com decisões, consequências e caminhos definidos por você.",
  matching: "Relacionar dois conjuntos de cartões, com opções extras sem par.",
  ordering: "Colocar etapas de um processo na sequência correta.",
  categorization: "Distribuir itens entre categorias definidas por você.",
}

const id = () => crypto.randomUUID()

export function newQuestion(): QuizQuestion {
  return {
    id: id(), text: "", selection: "single", weight: 1, explanation: "",
    options: [0, 1].map(() => ({ id: id(), text: "", is_correct: false, feedback: "" })),
  }
}

export function newStep(): ScenarioStep {
  return {
    id: id(), text: "",
    options: [0, 1].map(() => ({ id: id(), text: "", score: 0, feedback: "", next_step_id: null })),
  }
}

export function newPair(): MatchingCard {
  return { id: id(), right_id: id(), left: "", right: "", feedback: "" }
}

export function newOrderingItem(): OrderingItem {
  return { id: id(), text: "" }
}

export function newCategory(): Category {
  return { id: id(), text: "", description: "" }
}

export function newCategorizedItem(categoryId: string): CategorizedItem {
  return { id: id(), text: "", category_id: categoryId, feedback: "" }
}

export function emptyCategorization(): CategorizationConfig {
  const categories = [newCategory(), newCategory()]
  return { categories, items: [] }
}

export function newGame(format: GameFormat, eixo: string): GameDraft {
  const base = { title: "", instructions: "", eixo }
  switch (format) {
    case "quiz":
      return { ...base, format, config: { questions: [] } }
    case "open_response":
      return { ...base, format, config: { questions: [] } }
    case "scenario":
      return { ...base, format, config: { start_step_id: "", steps: [] } }
    case "matching":
      return { ...base, format, config: { pairs: [newPair(), newPair()], distractors: [] } }
    case "ordering":
      return { ...base, format, config: { items: [newOrderingItem(), newOrderingItem()], explanation: "" } }
    default:
      return { ...base, format, config: emptyCategorization() }
  }
}
