// features/audit/types.ts — Histórico de alterações da gestão.

/** Um campo alterado ({antes, depois}) ou um dado da ação, como {"senha": "redefinida"}. */
export type AuditChange = { antes: unknown; depois: unknown }
export type AuditDetails = Record<string, AuditChange | unknown>

export type AuditEntityType = "submission" | "activity" | "node" | "user" | "material" | "game"

export interface AuditEntry {
  id: string
  created_at: string
  actor_id: string | null
  actor_name: string
  /** Código da ação, como "activity.update"; o texto em português vem de labels.ts. */
  action: string
  entity_type: AuditEntityType | string
  entity_id: string | null
  entity_name: string | null
  eixo: string | null
  target_user_id: string | null
  target_user_name: string | null
  details: AuditDetails | null
}

export interface AuditActor {
  id: string
  name: string
}

export interface AuditPage {
  items: AuditEntry[]
  total: number
  /** Quem aparece no escopo de quem consulta, para o filtro "quem fez". */
  actors: AuditActor[]
}

export interface AuditFilters {
  actor_id?: string
  action?: string
  entity_type?: string
  /** Datas AAAA-MM-DD, inclusivas, no fuso do navegador. */
  date_from?: string
  date_to?: string
  limit?: number
  offset?: number
}
