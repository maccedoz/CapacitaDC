// features/audit/api.ts — Histórico de alterações (somente gestão; o servidor aplica o escopo).

import { apiClient } from "@/lib/api-client"
import type { AuditFilters, AuditPage } from "./types"

export const auditApi = {
  list: (filters: AuditFilters = {}) => {
    const query = new URLSearchParams()
    query.set("utc_offset_minutes", String(new Date().getTimezoneOffset()))
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value))
    })
    const suffix = query.toString()
    return apiClient.get<AuditPage>(`/api/audit${suffix ? `?${suffix}` : ""}`)
  },
}
