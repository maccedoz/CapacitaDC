export interface StepMetric {
  node_id: string
  name: string
  type: string
  is_required: boolean
  completed: number
  total: number
  rate: number | null
}

export interface GameMetric {
  node_id: string
  name: string
  game_title: string | null
  per_question: boolean
  played: number
  total: number
  average: number | null
  approved_rate: number | null
}

export interface DashboardOverview {
  trail: string
  trails: string[]
  participants: number
  steps: StepMetric[]
  games: GameMetric[]
}

export interface QuestionMetric {
  id: string
  text: string
  answers: number
  correct_rate: number
  score_rate: number | null
}

export interface RevisionMetrics {
  revision_id: string
  version: number | null
  title: string | null
  attempts: number
  average_first_grade: number | null
  items: QuestionMetric[]
}

export interface QuestionStats {
  node_id: string
  name: string
  available: boolean
  revisions: RevisionMetrics[]
}
