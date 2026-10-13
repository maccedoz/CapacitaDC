"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { gamesApi } from "@/features/games/api"
import type { GameReview, ReviewFilters } from "@/features/games/types"
import { asUtcDate } from "@/lib/datetime"
import { groupByEixo, memberAxisLabels, type MemberAxis } from "@/lib/roles"

const selectClass = "h-9 max-w-full rounded-md border border-border bg-secondary px-3 text-sm"
const pageSize = 20

export function OpenResponseQueue({ isOrganizer, managerAxis, onGraded }: {
  isOrganizer: boolean; managerAxis: MemberAxis | null; onGraded: () => void
}) {
  const [filters, setFilters] = useState<ReviewFilters>({ status: "pending", offset: 0 })
  const [items, setItems] = useState<GameReview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [hasMore, setHasMore] = useState(false)
  const requestVersion = useRef(0)
  const axes = isOrganizer ? ["trainee"] : managerAxis ? ["trainee", managerAxis] : ["trainee", "vendas", "conexoes", "experiencia", "all"]
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true)
    setError("")
    try {
      const rows = await gamesApi.reviews({ ...filters, limit: pageSize + 1 })
      if (version !== requestVersion.current) return
      setItems(rows.slice(0, pageSize))
      setHasMore(rows.length > pageSize)
    } catch (cause) {
      if (version === requestVersion.current) setError(cause instanceof Error ? cause.message : "Não foi possível carregar os questionários.")
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [filters])
  useEffect(() => { void refresh(); return () => { requestVersion.current++ } }, [refresh])
  const change = (patch: Partial<ReviewFilters>) => setFilters(previous => ({ ...previous, ...patch, offset: 0 }))
  const saved = (updated: GameReview) => {
    setItems(previous => filters.status === "pending" ? previous.filter(item => item.id !== updated.id) : previous.map(item => item.id === updated.id ? updated : item))
    onGraded()
  }
  return <div className="space-y-5">
    <p className="text-sm text-muted-foreground">Avalie cada pergunta de 0 a 10. A nota do jogo é a média ponderada pelos pesos definidos na publicação.</p>
    <div className="flex flex-wrap gap-2">
      <select aria-label="Situação dos questionários" className={selectClass} value={filters.status} onChange={event => change({ status: event.target.value as ReviewFilters["status"] })}>
        <option value="pending">Pendentes</option><option value="graded">Corrigidos</option><option value="all">Todos</option>
      </select>
      <select aria-label="Eixo dos questionários" className={selectClass} value={filters.eixo || ""} onChange={event => change({ eixo: event.target.value || undefined })}>
        <option value="">Todos os públicos</option>{axes.map(eixo => <option key={eixo} value={eixo}>{eixo === "trainee" ? "Trainees" : eixo === "all" ? "Todos os eixos" : memberAxisLabels[eixo as MemberAxis]}</option>)}
      </select>
      {!isOrganizer && <select aria-label="Participantes dos questionários" className={selectClass} value={filters.user_type || "all"} onChange={event => change({ user_type: event.target.value as ReviewFilters["user_type"] })}>
        <option value="all">Trainees e membros</option><option value="trainee">Trainees</option><option value="membro">Membros</option>
      </select>}
      <Button size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}>Atualizar questionários</Button>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {loading ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />Carregando questionários…</p> : !items.length ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhum questionário encontrado para estes filtros.</p> : groupByEixo(items).map(({ eixo, label, items: rows }) => <section key={eixo} className="space-y-3">
      <h3 className="border-b pb-2 font-semibold">{label}</h3>
      {rows.map(item => <ReviewRow key={item.id} item={item} onSaved={saved} />)}
    </section>)}
    <div className="flex items-center justify-between gap-3 text-sm">
      <Button variant="outline" size="sm" disabled={loading || !filters.offset} onClick={() => setFilters(previous => ({ ...previous, offset: Math.max(0, (previous.offset || 0) - pageSize) }))}>Anterior</Button>
      <span>Página {Math.floor((filters.offset || 0) / pageSize) + 1}</span>
      <Button variant="outline" size="sm" disabled={loading || !hasMore} onClick={() => setFilters(previous => ({ ...previous, offset: (previous.offset || 0) + pageSize }))}>Próxima</Button>
    </div>
  </div>
}

function ReviewRow({ item, onSaved }: { item: GameReview; onSaved: (item: GameReview) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState(() => Object.fromEntries(item.questions.map(question => [question.id, { grade: question.grade == null ? "" : String(question.grade), feedback: question.feedback }])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const pending = useRef(false)
  const numeric = (value: string) => Number(value.replace(",", "."))
  const valid = item.questions.every(question => {
    const value = draft[question.id]?.grade ?? ""
    return value.trim() !== "" && Number.isFinite(numeric(value)) && numeric(value) >= 0 && numeric(value) <= 10
  })
  const totalWeight = item.questions.reduce((sum, question) => sum + question.weight, 0)
  const average = valid ? item.questions.reduce((sum, question) => sum + numeric(draft[question.id].grade) * question.weight, 0) / totalWeight : null
  const save = async () => {
    if (pending.current || !valid) return
    pending.current = true
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const updated = await gamesApi.gradeReview(item.id, item.questions.map(question => ({ question_id: question.id, grade: numeric(draft[question.id].grade), feedback: draft[question.id].feedback })))
      onSaved(updated)
      setMessage("Correção salva.")
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar. Sua correção foi mantida.") }
    finally { pending.current = false; setBusy(false) }
  }
  return <article className="space-y-4 rounded-xl border bg-card p-4" aria-label={`Questionário de ${item.user_name}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1"><h4 className="font-semibold">{item.title} — {item.user_name}</h4>
        <p className="text-xs text-muted-foreground">{item.node_name} · versão {item.version} · {item.user_type === "trainee" ? "Trainee" : "Membro"} · enviado em {asUtcDate(item.submitted_at).toLocaleString("pt-BR")}</p>
        <p className="text-sm">{item.grade == null ? "Aguardando correção" : `Nota: ${item.grade.toFixed(2)} / 10`}</p>
        {item.graded_at && <p className="text-xs text-muted-foreground">Corrigido por {item.graded_by_name || "gestão"} em {asUtcDate(item.graded_at).toLocaleString("pt-BR")}</p>}
      </div>
      <Button variant="outline" size="sm" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Recolher" : item.grade == null ? "Corrigir respostas" : "Editar correção"}</Button>
    </div>
    {expanded && <>
      <fieldset disabled={busy} className="space-y-4">
        {item.questions.map((question, index) => <section key={question.id} className="space-y-3 rounded-lg border p-4">
          <h5 className="font-medium">Pergunta {index + 1} · peso {question.weight}</h5>
          <p className="whitespace-pre-wrap text-sm">{question.text}</p>
          <p className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">{question.answer}</p>
          {question.grading_notes && <details className="text-sm"><summary className="cursor-pointer font-medium">Orientação de correção</summary><p className="mt-2 whitespace-pre-wrap">{question.grading_notes}</p></details>}
          <div className="space-y-1"><label className="text-sm" htmlFor={`grade-${item.id}-${question.id}`}>Nota da pergunta {index + 1} (0 a 10)</label>
            <Input id={`grade-${item.id}-${question.id}`} inputMode="decimal" className="max-w-40" value={draft[question.id].grade} onChange={event => setDraft(previous => ({ ...previous, [question.id]: { ...previous[question.id], grade: event.target.value } }))} />
          </div>
          <div className="space-y-1"><label className="text-sm" htmlFor={`feedback-${item.id}-${question.id}`}>Feedback da pergunta {index + 1} (opcional)</label>
            <Textarea id={`feedback-${item.id}-${question.id}`} maxLength={10000} value={draft[question.id].feedback} onChange={event => setDraft(previous => ({ ...previous, [question.id]: { ...previous[question.id], feedback: event.target.value } }))} />
          </div>
        </section>)}
      </fieldset>
      <p className="text-sm">Nota final: {average == null ? "preencha todas as notas" : `${average.toFixed(2)} / 10`}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
      <Button disabled={busy || !valid} onClick={() => void save()}>{busy ? "Salvando correção…" : "Salvar correção"}</Button>
    </>}
  </article>
}
