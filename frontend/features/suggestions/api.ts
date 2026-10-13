// features/suggestions/api.ts — Sugestões dos trainees.

import { apiClient } from "@/lib/api-client"

export interface Suggestion {
  id: string
  author_id: string | null
  author_name: string
  text: string
  created_at: string
  read_at: string | null
}

export const SUGGESTION_MAX_LENGTH = 2000

export const suggestionsApi = {
  create: (text: string) => apiClient.post<Suggestion>("/api/suggestions", { text }),
  mine: () => apiClient.get<Suggestion[]>("/api/suggestions/mine"),
  list: () => apiClient.get<Suggestion[]>("/api/suggestions"),
  mark: (id: string, read: boolean) => apiClient.patch<Suggestion>(`/api/suggestions/${id}`, { read }),
}
