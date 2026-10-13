"use client"

import { useState } from "react"
import { Check, Lightbulb, Undo2 } from "lucide-react"
import { asUtcDate } from "@/lib/datetime"
import { useDashboard } from "@/components/dashboard/dashboard-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

/** Caixa de sugestões dos trainees, para administradores e organizadores. */
export function SuggestionsTab() {
  const { suggestions: state } = useDashboard()
  const [filter, setFilter] = useState<"unread" | "all">("unread")
  const [error, setError] = useState<string | null>(null)

  if (!state) return null
  const { suggestions, loading, unread, mark } = state
  const visible = filter === "unread" ? suggestions.filter(item => !item.read_at) : suggestions

  const toggle = async (id: string, read: boolean) => {
    setError(null)
    try { await mark(id, read) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível atualizar a sugestão.") }
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold text-foreground">Sugestões dos trainees</h2>
          <p className="text-muted-foreground text-sm">Ideias e sugestões enviadas pelos trainees, com o nome de quem enviou.</p>
        </div>
        <div className="flex gap-2" role="group" aria-label="Filtrar sugestões">
          <Button size="sm" variant={filter === "unread" ? "default" : "outline"} aria-pressed={filter === "unread"} onClick={() => setFilter("unread")}>
            Não lidas{unread > 0 ? ` (${unread})` : ""}
          </Button>
          <Button size="sm" variant={filter === "all" ? "default" : "outline"} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            Todas
          </Button>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}

      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">Carregando...</p>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl">
          <Lightbulb className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{filter === "unread" ? "Nenhuma sugestão por ler." : "Nenhuma sugestão recebida ainda."}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map(item => (
            <li key={item.id} className={`rounded-xl border bg-card p-4 space-y-2 ${item.read_at ? "border-border" : "border-primary/40"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                    {item.author_name}
                    {!item.read_at && <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px]">Nova</Badge>}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{asUtcDate(item.created_at).toLocaleString("pt-BR")}</p>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={() => void toggle(item.id, !item.read_at)}>
                  {item.read_at ? <><Undo2 className="mr-1 size-3" />Marcar como não lida</> : <><Check className="mr-1 size-3" />Marcar como lida</>}
                </Button>
              </div>
              <p className="text-sm text-foreground whitespace-pre-line">{item.text}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
