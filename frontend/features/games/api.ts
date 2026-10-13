import { apiClient } from "@/lib/api-client"
import type { AttemptPayload, Game, GameAttempt, GameDraft, GameReview, QuestionGrade, ReviewFilters } from "./types"

export const gamesApi = {
  list: () => apiClient.get<Game[]>("/api/games"),
  get: (id: string) => apiClient.get<Game>(`/api/games/${id}`),
  create: (draft: GameDraft) => apiClient.post<Game>("/api/games", draft),
  update: (id: string, draft: GameDraft) => apiClient.patch<Game>(`/api/games/${id}`, draft),
  publish: (id: string) => apiClient.post<Game>(`/api/games/${id}/publish`),
  duplicate: (id: string) => apiClient.post<Game>(`/api/games/${id}/duplicate`),
  remove: (id: string) => apiClient.delete(`/api/games/${id}`),
  begin: (nodeId: string, newAttempt = false) => apiClient.post<GameAttempt>(`/api/nodes/${nodeId}/attempts${newAttempt ? "?new_attempt=true" : ""}`),
  reviews: (filters: ReviewFilters) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value != null && value !== "").map(([key, value]) => [key, String(value)]))
    return apiClient.get<GameReview[]>(`/api/game-reviews?${query}`)
  },
  gradeReview: (id: string, questions: QuestionGrade[]) => apiClient.post<GameReview>(`/api/game-reviews/${id}/grade`, { questions }),
  getAttempt: (id: string) => apiClient.get<GameAttempt>(`/api/game-attempts/${id}`),
  answer: (id: string, stepId: string, optionId: string) =>
    apiClient.post<GameAttempt>(`/api/game-attempts/${id}/answers`, { step_id: stepId, option_id: optionId }),
  complete: (id: string, payload: AttemptPayload = {}) =>
    apiClient.post<GameAttempt>(`/api/game-attempts/${id}/complete`, payload),
}
