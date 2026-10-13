"use client"

import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { Trash2 } from "lucide-react"
import { asUtcDate } from "@/lib/datetime"
import { SubmissionContent, openFirstItem } from "@/components/activities/submission-content"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import type { ActivitySubmissionOut } from "@/features/activities/types"

/** O que a fila consegue fazer numa linha a partir do teclado. */
export interface CorrectionRowHandle {
  focusGrade: () => void
  open: () => void
}

interface CorrectionRowProps {
  submission: ActivitySubmissionOut
  /** Mostra atividade e pessoa; desnecessário dentro da própria atividade. */
  showContext?: boolean
  /** `advance`: a pessoa pediu para salvar e ir para a próxima entrega (Enter). */
  onGrade: (grade: number, feedback: string, advance: boolean) => Promise<unknown>
  /** Ausente esconde o botão de excluir — nem toda tela deve permitir apagar envios. */
  onDelete?: () => Promise<unknown>
  // Fila de correções: seleção para o lote e atalhos de teclado (opcionais).
  selected?: boolean
  onToggleSelect?: () => void
  active?: boolean
  onFocusRow?: () => void
  onNavigate?: (delta: 1 | -1) => void
  onShowHelp?: () => void
  registerHandle?: (handle: CorrectionRowHandle | null) => void
}

export function CorrectionRow({
  submission, showContext = false, onGrade, onDelete,
  selected = false, onToggleSelect, active = false, onFocusRow, onNavigate, onShowHelp, registerHandle,
}: CorrectionRowProps) {
  const [grade, setGrade] = useState(submission.grade?.toString() ?? "")
  const [feedback, setFeedback] = useState(submission.feedback ?? "")
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState("")
  const gradeInput = useRef<HTMLInputElement>(null)
  const feedbackInput = useRef<HTMLInputElement>(null)

  const open = () => {
    setError("")
    openFirstItem(submission)
      .then(opened => { if (!opened) setError("Esta entrega não tem anexo nem link.") })
      .catch(cause => setError(cause instanceof Error ? cause.message : "Não foi possível abrir o anexo."))
  }

  useEffect(() => {
    if (!registerHandle) return
    registerHandle({ focusGrade: () => gradeInput.current?.focus(), open })
    return () => registerHandle(null)
  })

  const save = async (advance: boolean) => {
    const value = Number(grade.replace(",", "."))
    if (!grade.trim() || Number.isNaN(value) || value < 0 || value > 10) {
      setError("Informe uma nota entre 0 e 10.")
      return
    }
    setBusy(true)
    setError("")
    try {
      await onGrade(value, feedback, advance)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a nota.")
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!onDelete) return
    if (!confirm(`Excluir o envio de ${submission.user_name || "esta pessoa"}? A etapa da trilha volta a ficar pendente.`)) return
    setDeleting(true)
    setError("")
    try {
      await onDelete()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível excluir o envio.")
      setDeleting(false)
    }
  }

  // O campo de nota só aceita números, então as letras ficam livres para atalhos.
  const onGradeKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      void save(true)
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey || !onNavigate) return
    const key = event.key.toLowerCase()
    const actions: Record<string, () => void> = {
      j: () => onNavigate(1),
      k: () => onNavigate(-1),
      x: () => onToggleSelect?.(),
      o: open,
      f: () => feedbackInput.current?.focus(),
      "?": () => onShowHelp?.(),
    }
    if (actions[key]) {
      event.preventDefault()
      actions[key]()
    }
  }

  // No feedback, texto livre: só Ctrl+Enter (salvar e ir para a próxima) e Esc.
  const onFeedbackKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      void save(true)
    } else if (event.key === "Escape" && onNavigate) {
      event.preventDefault()
      gradeInput.current?.focus()
    }
  }

  return <div onFocusCapture={onFocusRow} data-submission-id={submission.id}
    className={`space-y-2 rounded-lg border p-3 transition-colors ${active ? "border-primary/60 bg-primary/5" : "border-border"}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        {onToggleSelect && (
          <Checkbox checked={selected} onCheckedChange={() => onToggleSelect()}
            aria-label={`Selecionar a entrega de ${submission.user_name || "esta pessoa"} para correção em lote`} />
        )}
        <span className="text-xs font-semibold text-foreground">{submission.user_name}</span>
      </div>
      <div className="flex items-center gap-2">
        {submission.submitted_at && (
          <span className="text-[10px] text-muted-foreground">
            {asUtcDate(submission.submitted_at).toLocaleString("pt-BR")}
          </span>
        )}
        {onDelete && (
          <Button size="sm" variant="ghost" disabled={deleting}
            className="h-6 w-6 p-0 text-rose-400 light:text-rose-700 hover:text-rose-300 light:hover:text-rose-800 hover:bg-rose-500/10"
            onClick={() => void remove()} aria-label="Excluir envio">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
    {showContext && (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-foreground">{submission.activity_title}</span>
        {submission.activity_weight != null && <Badge variant="outline" className="text-[10px]">peso {submission.activity_weight}</Badge>}
        {submission.user_type && <Badge variant="secondary" className="text-[10px]">{submission.user_type}</Badge>}
        {submission.grade == null && <Badge className="bg-amber-500/20 text-amber-400 light:text-amber-700 text-[10px]">Pendente</Badge>}
      </div>
    )}
    <SubmissionContent submission={submission} />
    <div className="flex items-center gap-2">
      <Input ref={gradeInput} aria-label="Nota de 0 a 10" placeholder="Nota (0-10)" value={grade} disabled={busy}
        inputMode="decimal" onChange={event => setGrade(event.target.value)} onKeyDown={onGradeKeyDown}
        className="h-7 w-28 border-border bg-secondary text-xs" />
      <Input ref={feedbackInput} aria-label="Feedback" placeholder="Feedback" value={feedback} disabled={busy}
        onChange={event => setFeedback(event.target.value)} onKeyDown={onFeedbackKeyDown}
        className="h-7 flex-1 border-border bg-secondary text-xs" />
      <Button size="sm" className="h-7 px-3 text-xs" disabled={busy} onClick={() => void save(false)}>
        {busy ? "Salvando…" : "Salvar"}
      </Button>
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {submission.grade != null && (
      <p className="text-xs font-semibold text-emerald-400 light:text-emerald-700">
        Nota atual: {submission.grade.toFixed(1)}
        {submission.graded_by_name && (
          <span className="font-normal text-muted-foreground">
            {" "}· corrigida por {submission.graded_by_name}
            {submission.graded_at && ` em ${asUtcDate(submission.graded_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`}
          </span>
        )}
      </p>
    )}
  </div>
}
