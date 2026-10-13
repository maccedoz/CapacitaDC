// features/gamification/types.ts — Points, level, achievements and ranking (members only)

export interface MemberLevel {
  number: number
  name: string
  min_points: number
  /** Points that reach the next level; null at the last one. */
  next_points: number | null
}

export interface Achievement {
  id: string
  title: string
  description: string
  earned: boolean
  progress?: { current: number; target: number }
}

export interface RankingEntry {
  user_id: string
  name: string
  eixo: string | null
  points: number
  level: number
  /** Tied members share a position. */
  position: number
  is_me: boolean
}

export interface GamificationSummary {
  points: number
  level: MemberLevel
  eixo: string | null
  achievements: Achievement[]
  /** Conquistas ganhas depois da primeira consulta e cujo aviso ainda não foi confirmado. */
  new_achievements: Achievement[]
  ranking: RankingEntry[]
}
