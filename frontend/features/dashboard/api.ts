import { apiClient } from "@/lib/api-client"
import type { DashboardOverview, QuestionStats } from "./types"

export const dashboardApi = {
  overview: (trail: string) => apiClient.get<DashboardOverview>(`/api/dashboard?trail=${encodeURIComponent(trail)}`),
  questions: (nodeId: string) => apiClient.get<QuestionStats>(`/api/dashboard/games/${encodeURIComponent(nodeId)}`),
}
