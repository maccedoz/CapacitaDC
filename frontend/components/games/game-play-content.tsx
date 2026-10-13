"use client"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { GameResult, OpenQuestion, PublicQuestion, PublicStep } from "@/features/games/types"

export function OpenResponseChoices({ questions, answers, onChange, disabled, readOnly = false }: {
  questions: Pick<OpenQuestion, "id" | "text">[]; answers: Record<string, string>
  onChange?: (questionId: string, text: string) => void; disabled?: boolean; readOnly?: boolean
}) {
  return <div className="space-y-5">{questions.map((question, index) => <section key={question.id} className="space-y-3 rounded-lg border p-4">
    <h3 className="text-sm font-semibold">Pergunta {index + 1}</h3>
    <p className="whitespace-pre-wrap font-medium">{question.text}</p>
    {readOnly ? <p className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">{answers[question.id]}</p> : <>
      <label className="text-sm" htmlFor={`open-answer-${question.id}`}>Resposta da pergunta {index + 1}</label>
      <Textarea id={`open-answer-${question.id}`} rows={5} maxLength={5000} disabled={disabled} value={answers[question.id] || ""} onChange={event => onChange?.(question.id, event.target.value)} />
      <p className="text-xs text-muted-foreground">{(answers[question.id] || "").length} / 5.000 caracteres</p>
    </>}
  </section>)}</div>
}

export function QuizChoices({ questions, answers, onChange, disabled }: { questions: PublicQuestion[]; answers: Record<string, string[]>; onChange: (questionId: string, optionIds: string[]) => void; disabled?: boolean }) {
  return <div className="space-y-6">{questions.map((question, index) => <fieldset key={question.id} disabled={disabled} className="space-y-3 rounded-lg border p-4">
    <legend className="px-1 text-sm font-semibold">Pergunta {index + 1}</legend>
    <p className="whitespace-pre-wrap font-medium">{question.text}</p>
    <p className="text-xs text-muted-foreground">{question.selection === "multiple" ? "Selecione todas as opções corretas." : "Selecione uma opção."}</p>
    {question.options.map(option => <label key={option.id} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
      <input type={question.selection === "multiple" ? "checkbox" : "radio"} name={`answer-${question.id}`} className="mt-0.5 size-4 shrink-0 accent-primary" checked={(answers[question.id] || []).includes(option.id)} onChange={event => onChange(question.id, question.selection === "single" ? [option.id] : event.target.checked ? [...(answers[question.id] || []), option.id] : (answers[question.id] || []).filter(id => id !== option.id))} />
      <span className="whitespace-pre-wrap">{option.text}</span>
    </label>)}
  </fieldset>)}</div>
}

export function ScenarioChoices({ step, onSelect, disabled }: { step: PublicStep; onSelect: (optionId: string) => void; disabled?: boolean }) {
  return <div className="space-y-4">
    <p className="whitespace-pre-wrap rounded-lg bg-muted p-4 font-medium">{step.text}</p>
    <p className="text-sm text-muted-foreground">Escolha uma decisão para continuar.</p>
    <div className="grid gap-3">{step.options.map(option => <Button key={option.id} type="button" variant="outline" disabled={disabled} className="h-auto justify-start whitespace-pre-wrap p-4 text-left" onClick={() => onSelect(option.id)}>{option.text}</Button>)}</div>
  </div>
}

const grade = (value: number) => value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** Whether the best grade concludes the step; shown after real attempts only. */
export function MinimumGradeNotice({ minGrade, stepCompleted, bestGrade }: { minGrade?: number | null; stepCompleted?: boolean; bestGrade?: number | null }) {
  if (minGrade == null || stepCompleted == null) return null
  return stepCompleted
    ? <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300">Etapa concluída: sua melhor nota atingiu o mínimo de {grade(minGrade)}.</p>
    : <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
      Você precisa de nota {grade(minGrade)} ou mais para concluir esta etapa e avançar na trilha.
      {bestGrade != null && ` Sua melhor nota até agora é ${grade(bestGrade)}.`} Tente novamente: vale a melhor nota.
    </p>
}

const statusStyle = {
  correct: { label: "Resposta correta", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" },
  partial: { label: "Parcialmente correta", className: "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200" },
  incorrect: { label: "Resposta incorreta", className: "border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-300" },
}

function AnswerStatus({ item }: { item: GameResult["feedback"][number] }) {
  const status = item.status ?? (typeof item.is_correct === "boolean" ? (item.is_correct ? "correct" : "incorrect") : null)
  if (!status) return null
  const { label, className } = statusStyle[status]
  // Multiple-choice questions also say how many right options were chosen.
  const counts = item.correct_total != null && item.correct_total > 1 && item.correct_selected != null
    ? `${item.correct_selected} de ${item.correct_total} alternativas corretas marcadas${item.wrong_selected ? ` · ${plural(item.wrong_selected, "alternativa incorreta marcada", "alternativas incorretas marcadas")}` : ""}`
    : null
  return <div className="flex flex-wrap items-center gap-2 text-sm">
    <span className={`rounded-full border px-2.5 py-0.5 font-medium ${className}`}>{label}</span>
    {counts && <span className="text-muted-foreground">{counts}</span>}
    {item.status && <span className="text-muted-foreground">· {grade(item.score)} de {grade(item.max_score)} {item.max_score === 1 ? "ponto" : "pontos"}</span>}
  </div>
}

export function GameResultView({ result, preview = false }: { result: GameResult; preview?: boolean }) {
  const pending = !preview && result.min_grade != null && result.step_completed === false
  return <div className="space-y-5">
    <div className="rounded-xl bg-primary/5 p-5 text-center">
      <h3 className="text-lg font-semibold">{preview ? "Resultado da prévia" : pending ? "Tentativa concluída" : "Jogo concluído"}</h3>
      {(result.grade != null || preview) && <p className="mt-2 text-2xl font-bold text-primary">Nota: {(result.grade ?? (result.max_score ? 10 * result.attempt_score / result.max_score : 0)).toFixed(2)} / 10</p>}
      {!preview && result.best_grade != null && <p className="mt-2 text-sm text-muted-foreground">Melhor nota: {result.best_grade.toFixed(2)} / 10</p>}
    </div>
    {!preview && <MinimumGradeNotice minGrade={result.min_grade} stepCompleted={result.step_completed} bestGrade={result.best_grade} />}
    {result.note && <p className="whitespace-pre-wrap rounded-lg border p-4 text-sm">{result.note}</p>}
    <div className="space-y-3">{result.feedback.map((item, index) => <section key={item.question_id || item.step_id || item.item_id || index} className="space-y-2 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4"><p className="whitespace-pre-wrap text-sm font-medium">{item.text}</p></div>
      <AnswerStatus item={item} />
      {item.answer != null && <><p className="text-xs font-semibold text-muted-foreground">Sua resposta</p><p className="whitespace-pre-wrap break-words text-sm">{item.answer}</p></>}
      {item.grade != null && <p className="text-sm font-medium">Nota da pergunta: {grade(item.grade)} / 10</p>}
      {item.feedback && <p className="whitespace-pre-wrap text-sm">{item.feedback}</p>}
      {item.explanation && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.explanation}</p>}
    </section>)}</div>
  </div>
}
