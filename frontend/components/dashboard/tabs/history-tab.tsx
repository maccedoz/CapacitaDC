"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronDown, History, Loader2 } from "lucide-react"
import { asUtcDate } from "@/lib/datetime"
import { useDashboard } from "@/components/dashboard/dashboard-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { auditApi } from "@/features/audit/api"
import { AUDIT_GROUPS, describeAudit, detailLines, scopeLabel } from "@/features/audit/labels"
import type { AuditActor, AuditEntry, AuditFilters } from "@/features/audit/types"

const PAGE_SIZE = 50
const selectClass = "h-9 rounded-md border border-border bg-secondary px-3 text-xs text-foreground"
const EMPTY_FILTERS: AuditFilters = {}

/** Histórico de alterações da gestão. O servidor só devolve o que o perfil pode ver. */
export function HistoryTab() {
  const { isManager, isOrg, axisName } = useDashboard()
  const [filters, setFilterState] = useState<AuditFilters>(EMPTY_FILTERS)
  const [offset, setOffset] = useState(0)
  const [items, setItems] = useState<AuditEntry[]>([])
  const [actors, setActors] = useState<AuditActor[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const requestVersion = useRef(0)

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true)
    setError("")
    try {
      const page = await auditApi.list({ ...filters, limit: PAGE_SIZE, offset })
      if (version !== requestVersion.current) return
      setItems(page.items)
      setTotal(page.total)
      setActors(page.actors)
    } catch (cause) {
      if (version === requestVersion.current) setError(cause instanceof Error ? cause.message : "Não foi possível carregar o histórico.")
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [filters, offset])

  useEffect(() => { void refresh(); return () => { requestVersion.current++ } }, [refresh])

  const setFilter = (key: keyof AuditFilters, value: string) => {
    setFilterState(previous => ({ ...previous, [key]: value || undefined }))
    setOffset(0)
  }
  const hasFilters = Object.values(filters).some(Boolean)
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const page = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <>
      <div className="space-y-1">
        <h2 className="text-2xl font-bold text-foreground">Histórico de alterações</h2>
        <p className="text-muted-foreground text-sm">
          Quem mudou o quê e quando: correções, atividades, trilha, pessoas, materiais e jogos.{" "}
          {isManager ? `Você vê o que aconteceu em ${axisName} e no PlugInfo.` : isOrg ? "Você vê o que aconteceu no PlugInfo." : "Você vê todos os eixos."}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="history-actor" className="text-xs text-muted-foreground">Quem fez</Label>
          <select id="history-actor" className={`${selectClass} max-w-xs`} value={filters.actor_id ?? ""}
            onChange={event => setFilter("actor_id", event.target.value)}>
            <option value="">Todas as pessoas</option>
            {actors.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="history-type" className="text-xs text-muted-foreground">Tipo de ação</Label>
          <select id="history-type" className={selectClass} value={filters.entity_type ?? ""}
            onChange={event => setFilter("entity_type", event.target.value)}>
            <option value="">Todos os tipos</option>
            {AUDIT_GROUPS.map(group => <option key={group.value} value={group.value}>{group.label}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="history-from" className="text-xs text-muted-foreground">De</Label>
          <Input id="history-from" type="date" className="h-9 w-40 text-xs" value={filters.date_from ?? ""}
            max={filters.date_to} onChange={event => setFilter("date_from", event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="history-to" className="text-xs text-muted-foreground">Até</Label>
          <Input id="history-to" type="date" className="h-9 w-40 text-xs" value={filters.date_to ?? ""}
            min={filters.date_from} onChange={event => setFilter("date_to", event.target.value)} />
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => { setFilterState(EMPTY_FILTERS); setOffset(0) }}>Limpar filtros</Button>
        )}
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}>Atualizar</Button>
      </div>

      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

      {loading ? (
        <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />Carregando histórico…
        </p>
      ) : !error && items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <History className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">{hasFilters ? "Nenhuma alteração neste filtro" : "Nenhuma alteração registrada ainda"}</p>
          <p className="mt-1 text-xs text-muted-foreground">Correções, edições e exclusões feitas pela gestão aparecem aqui.</p>
        </div>
      ) : (
        <ul className="space-y-2" aria-label="Alterações">
          {items.map(entry => <HistoryRow key={entry.id} entry={entry} />)}
        </ul>
      )}

      {total > 0 && (
        <nav aria-label="Páginas do histórico" className="flex items-center justify-between gap-3">
          <Button variant="outline" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Anterior</Button>
          <span className="text-sm text-muted-foreground">Página {page} de {pages}</span>
          <Button variant="outline" disabled={loading || page >= pages} onClick={() => setOffset(offset + PAGE_SIZE)}>Próxima</Button>
        </nav>
      )}
    </>
  )
}

function HistoryRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false)
  const lines = detailLines(entry.details)
  const group = AUDIT_GROUPS.find(item => item.value === entry.entity_type)?.label
  const detailsId = `history-details-${entry.id}`
  return (
    <li className="rounded-xl border border-border bg-card p-4" data-action={entry.action}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
        <time dateTime={entry.created_at} className="shrink-0 text-xs text-muted-foreground sm:w-32 sm:pt-0.5">
          {asUtcDate(entry.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
        </time>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm text-foreground break-words">
            <span className="font-semibold">{entry.actor_name}</span> {describeAudit(entry)}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {group && <Badge variant="outline" className="text-[10px]">{group}</Badge>}
            {entry.eixo && <Badge variant="outline" className="text-[10px] text-muted-foreground">{scopeLabel(entry.eixo)}</Badge>}
          </div>
        </div>
        {lines.length > 0 && (
          <Button variant="ghost" size="sm" className="h-7 shrink-0 self-start text-xs" aria-expanded={open} aria-controls={detailsId}
            onClick={() => setOpen(value => !value)}>
            Detalhes<ChevronDown className={`ml-1 size-3 transition-transform ${open ? "rotate-180" : ""}`} />
          </Button>
        )}
      </div>
      {open && (
        <dl id={detailsId} className="mt-3 space-y-1 border-t border-border pt-3 text-xs sm:ml-36">
          {lines.map(line => (
            <div key={line.field} className="flex flex-wrap gap-x-1.5">
              <dt className="font-medium text-foreground">{line.field}:</dt>
              <dd className="min-w-0 break-words text-muted-foreground whitespace-pre-line">
                {line.before !== undefined ? <>{line.before} <span aria-label="para">→</span> {line.after}</> : line.after}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  )
}
