"use client"

import { useRef, useState, type KeyboardEvent } from "react"
import { ClipboardCheck, Keyboard, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useSubmissionQueue } from "@/features/activities/hooks"
import type { Activity, ActivitySubmissionOut } from "@/features/activities/types"
import { CorrectionRow, type CorrectionRowHandle } from "./correction-row"
import { groupByEixo, memberAxisLabels, type MemberAxis } from "@/lib/roles"

const selectClass = "h-9 rounded-md border border-border bg-secondary px-3 text-xs text-foreground"

const SHORTCUTS: Array<[string[], string, string]> = [
  [["Enter"], "campo de nota", "salva e vai para a próxima entrega"],
  [["Ctrl", "Enter"], "feedback", "salva e vai para a próxima"],
  [["J"], "fora do feedback", "próxima entrega, sem salvar"],
  [["K"], "fora do feedback", "entrega anterior, sem salvar"],
  [["X"], "fora do feedback", "marca ou desmarca para a correção em lote"],
  [["O"], "fora do feedback", "abre o anexo ou link da entrega"],
  [["F"], "campo de nota", "vai para o feedback"],
  [["Esc"], "feedback", "volta para o campo de nota"],
  [["?"], "fora do feedback", "mostra esta lista"],
]

interface CorrectionsQueueProps {
  activities: Activity[]
  isOrganizer: boolean
  /** O gerente corrige membros do próprio eixo e trainees; os filtros refletem isso. */
  managerAxis?: MemberAxis | null
  /** A média ponderada muda no servidor a cada nota, então a planilha recarrega. */
  onGraded?: () => void
}

export function CorrectionsQueue({ activities, isOrganizer, managerAxis = null, onGraded }: CorrectionsQueueProps) {
  const { items, filters, setFilters, setPage, pageSize, hasMore, loading, error, refresh, grade, gradeBatch, remove } = useSubmissionQueue()
  const handles = useRef(new Map<string, CorrectionRowHandle>())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batch, setBatch] = useState({ grade: "", feedback: "" })
  const [batchStatus, setBatchStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [savingBatch, setSavingBatch] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  // Separa a página atual da fila por eixo; a ordem pendentes-primeiro é mantida dentro de cada grupo.
  const groups = groupByEixo(items, item => item.activity_eixo)
  // O teclado segue a ordem da tela, não a do servidor.
  const order = groups.flatMap(group => group.items.map(item => item.id))
  // Seleções de entregas que saíram da lista (corrigidas, outro filtro) não contam.
  const selectedIds = order.filter(id => selected.has(id))
  const allSelected = order.length > 0 && selectedIds.length === order.length
  const axes = managerAxis
    ? [{ value: "trainee", label: "Trainee" }, { value: managerAxis, label: memberAxisLabels[managerAxis] }]
    : isOrganizer
    ? [{ value: "trainee", label: "Trainee" }]
    : [{ value: "trainee", label: "Trainee" }, { value: "vendas", label: "Vendas" },
       { value: "conexoes", label: "Conexões" }, { value: "experiencia", label: "Experiência" },
       { value: "all", label: "Todos os eixos" }]

  const changeFilters = (next: typeof filters) => {
    setSelected(new Set())
    setFilters(next)
  }

  const focusRow = (id: string | undefined) => {
    if (!id) return
    setActiveId(id)
    handles.current.get(id)?.focusGrade()
    document.querySelector(`[data-submission-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" })
  }

  const navigate = (fromId: string | null, delta: 1 | -1) => {
    const index = fromId ? order.indexOf(fromId) : -1
    const target = index < 0 ? order[0] : order[Math.min(order.length - 1, Math.max(0, index + delta))]
    focusRow(target)
  }

  const toggle = (id: string) => setSelected(previous => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const saveOne = async (submission: ActivitySubmissionOut, value: number, feedback: string, advance: boolean) => {
    const index = order.indexOf(submission.id)
    const leavesList = filters.status === "pending"
    // A próxima é decidida antes de salvar: nos pendentes, a entrega corrigida sai da lista.
    const nextId = order[index + 1] ?? (leavesList ? order[index - 1] : undefined)
    await grade(submission.activity_id, submission.id, value, feedback)
    onGraded?.()
    if (advance) setTimeout(() => focusRow(nextId), 0)
  }

  const applyBatch = async () => {
    const value = Number(batch.grade.replace(",", "."))
    setConfirming(false)
    setSavingBatch(true)
    setBatchStatus(null)
    try {
      const updated = await gradeBatch(selectedIds, value, batch.feedback)
      setSelected(new Set())
      setBatch({ grade: "", feedback: "" })
      setBatchStatus({ kind: "ok", text: `${updated.length} entrega${updated.length === 1 ? "" : "s"} corrigida${updated.length === 1 ? "" : "s"} com nota ${value.toFixed(1)}.` })
      onGraded?.()
    } catch (cause) {
      setBatchStatus({ kind: "error", text: cause instanceof Error ? cause.message : "Não foi possível corrigir o lote." })
    } finally {
      setSavingBatch(false)
    }
  }

  const batchValue = Number(batch.grade.replace(",", "."))
  const batchValid = batch.grade.trim() !== "" && !Number.isNaN(batchValue) && batchValue >= 0 && batchValue <= 10

  // Fora dos campos de texto (depois de clicar numa caixa de seleção, por exemplo).
  const onQueueKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest("input, textarea, select, [contenteditable=true]") || event.ctrlKey || event.metaKey || event.altKey) return
    const key = event.key.toLowerCase()
    if (key === "j" || key === "k") navigate(activeId, key === "j" ? 1 : -1)
    else if (key === "x" && activeId) toggle(activeId)
    else if (key === "o" && activeId) handles.current.get(activeId)?.open()
    else if (key === "?") setHelpOpen(true)
    else return
    event.preventDefault()
  }

  return <div className="space-y-4" onKeyDown={onQueueKeyDown}>
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Situação" className={selectClass} value={filters.status ?? "all"}
        onChange={event => changeFilters({ ...filters, status: event.target.value as typeof filters.status })}>
        <option value="pending">Pendentes</option>
        <option value="graded">Corrigidas</option>
        <option value="all">Todas</option>
      </select>
      {!isOrganizer && (
        <select aria-label="Tipo de pessoa" className={selectClass} value={filters.user_type ?? "all"}
          onChange={event => changeFilters({ ...filters, user_type: event.target.value as typeof filters.user_type })}>
          <option value="all">Trainees e membros</option>
          <option value="trainee">Trainees</option>
          <option value="membro">Membros</option>
        </select>
      )}
      <select aria-label="Eixo" className={selectClass} value={filters.eixo ?? ""}
        onChange={event => changeFilters({ ...filters, eixo: event.target.value || undefined })}>
        <option value="">Todos os eixos</option>
        {axes.map(axis => <option key={axis.value} value={axis.value}>{axis.label}</option>)}
      </select>
      <select aria-label="Atividade" className={`${selectClass} max-w-xs`} value={filters.activity_id ?? ""}
        onChange={event => changeFilters({ ...filters, activity_id: event.target.value || undefined })}>
        <option value="">Todas as atividades</option>
        {activities.filter(activity => !isOrganizer || activity.eixo === "trainee").map(activity => <option key={activity.id} value={activity.id}>{activity.title}</option>)}
      </select>
      <Button variant="outline" size="sm" disabled={loading} onClick={() => { setSelected(new Set()); void refresh() }}>Atualizar</Button>
      <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={() => setHelpOpen(true)}>
        <Keyboard className="mr-2 size-4" />Atalhos
      </Button>
    </div>

    {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

    {items.length > 0 && !loading && (
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={allSelected} aria-label="Selecionar todas as entregas da página"
            onCheckedChange={checked => setSelected(checked ? new Set(order) : new Set())} />
          Selecionar todas da página
        </label>
        <span>Dica: <Kbd>Enter</Kbd> no campo de nota salva e vai para a próxima; <Kbd>?</Kbd> mostra todos os atalhos.</span>
      </div>
    )}

    {selectedIds.length > 0 && (
      <div role="region" aria-label="Correção em lote"
        className="sticky top-20 z-[5] flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-card/95 p-3 shadow-sm backdrop-blur">
        <span className="text-sm font-semibold text-foreground">{selectedIds.length} selecionada{selectedIds.length === 1 ? "" : "s"}</span>
        <Input aria-label="Nota do lote" placeholder="Nota (0-10)" inputMode="decimal" value={batch.grade}
          onChange={event => setBatch(previous => ({ ...previous, grade: event.target.value }))}
          className="h-8 w-28 border-border bg-secondary text-xs" />
        <Input aria-label="Feedback do lote (opcional)" placeholder="Feedback comum (opcional)" value={batch.feedback}
          onChange={event => setBatch(previous => ({ ...previous, feedback: event.target.value }))}
          className="h-8 min-w-48 flex-1 border-border bg-secondary text-xs" />
        <Button size="sm" disabled={!batchValid || savingBatch} onClick={() => setConfirming(true)}>
          {savingBatch ? "Salvando…" : `Dar nota às ${selectedIds.length} selecionadas`}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Limpar seleção</Button>
      </div>
    )}
    {batchStatus && (
      <p role={batchStatus.kind === "error" ? "alert" : "status"}
        className={`text-sm ${batchStatus.kind === "error" ? "text-destructive" : "text-emerald-500 light:text-emerald-700"}`}>
        {batchStatus.text}
      </p>
    )}

    {loading ? (
      <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />Carregando envios…
      </p>
    ) : items.length === 0 ? (
      <div className="rounded-xl border border-dashed border-border py-12 text-center">
        <ClipboardCheck className="mx-auto mb-3 size-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Nenhum envio neste filtro</p>
        <p className="mt-1 text-xs text-muted-foreground">Quando alguém entregar uma atividade, o envio aparece aqui.</p>
      </div>
    ) : (
      <div className="space-y-6">
        {groups.map(({ eixo, label, items: groupItems }) => (
          <div key={eixo} className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground border-b border-border pb-2">{label}</h3>
            <div className="space-y-3">
              {groupItems.map(submission => (
                <CorrectionRow key={submission.id} submission={submission} showContext
                  selected={selected.has(submission.id)}
                  onToggleSelect={() => toggle(submission.id)}
                  active={activeId === submission.id}
                  onFocusRow={() => setActiveId(submission.id)}
                  onNavigate={delta => navigate(submission.id, delta)}
                  onShowHelp={() => setHelpOpen(true)}
                  registerHandle={handle => {
                    if (handle) handles.current.set(submission.id, handle)
                    else handles.current.delete(submission.id)
                  }}
                  onGrade={(value, feedback, advance) => saveOne(submission, value, feedback, advance)}
                  onDelete={async () => {
                    await remove(submission.activity_id, submission.id)
                    onGraded?.()
                  }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    )}
    <nav aria-label="Páginas de envios" className="flex items-center justify-between gap-3">
      <Button variant="outline" disabled={loading || !filters.offset} onClick={() => { setSelected(new Set()); setPage((filters.offset || 0) - pageSize) }}>Anterior</Button>
      <span className="text-sm text-muted-foreground">Página {Math.floor((filters.offset || 0) / pageSize) + 1}</span>
      <Button variant="outline" disabled={loading || !hasMore} onClick={() => { setSelected(new Set()); setPage((filters.offset || 0) + pageSize) }}>Próxima</Button>
    </nav>

    <AlertDialog open={confirming} onOpenChange={setConfirming}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Corrigir {selectedIds.length} entrega{selectedIds.length === 1 ? "" : "s"}?</AlertDialogTitle>
          <AlertDialogDescription>
            Todas recebem a nota {batchValid ? batchValue.toFixed(1) : "—"}
            {batch.feedback.trim() ? " e o mesmo feedback" : ""}. Se alguma não puder ser corrigida, nenhuma é alterada.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => void applyBatch()}>Corrigir</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Atalhos da fila de correções</DialogTitle>
          <DialogDescription>
            O campo de nota só aceita números, então as letras funcionam como atalhos ali. No feedback, que é texto livre, valem só Ctrl+Enter e Esc.
          </DialogDescription>
        </DialogHeader>
        <table className="w-full text-sm">
          <tbody>
            {SHORTCUTS.map(([keys, where, action]) => (
              <tr key={keys.join("+") + where} className="border-b border-border/50 last:border-0">
                <td className="py-2 pr-3 whitespace-nowrap">{keys.map((key, index) => <span key={key}>{index > 0 && " + "}<Kbd>{key}</Kbd></span>)}</td>
                <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">{where}</td>
                <td className="py-2">{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  </div>
}
