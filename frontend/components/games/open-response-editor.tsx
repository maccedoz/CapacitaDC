"use client"

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { OpenQuestion, OpenResponseConfig } from "@/features/games/types"
import { EditorField, moveItem } from "./editor-fields"

export function OpenResponseEditor({ config, onChange }: { config: OpenResponseConfig; onChange: (config: OpenResponseConfig) => void }) {
  const update = (index: number, patch: Partial<OpenQuestion>) => onChange({ questions: config.questions.map((question, i) => i === index ? { ...question, ...patch } : question) })
  return <div className="space-y-5">
    <p className="text-sm text-muted-foreground">Cada resposta será corrigida pela gestão com nota de 0 a 10. Os pesos definem a média das perguntas.</p>
    {config.questions.map((question, index) => <section key={question.id} className="space-y-4 rounded-lg border p-4" aria-label={`Pergunta ${index + 1}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Pergunta {index + 1}</h3>
        <div className="flex gap-1">
          <Button type="button" size="icon" variant="ghost" aria-label={`Mover pergunta ${index + 1} para cima`} disabled={index === 0} onClick={() => onChange({ questions: moveItem(config.questions, index, -1) })}><ArrowUp className="size-4" /></Button>
          <Button type="button" size="icon" variant="ghost" aria-label={`Mover pergunta ${index + 1} para baixo`} disabled={index === config.questions.length - 1} onClick={() => onChange({ questions: moveItem(config.questions, index, 1) })}><ArrowDown className="size-4" /></Button>
          <Button type="button" size="icon" variant="ghost" aria-label={`Excluir pergunta ${index + 1}`} onClick={() => onChange({ questions: config.questions.filter(item => item.id !== question.id) })}><Trash2 className="size-4" /></Button>
        </div>
      </div>
      <EditorField label="Enunciado"><Textarea maxLength={10000} value={question.text} onChange={event => update(index, { text: event.target.value })} /></EditorField>
      <EditorField label="Peso da pergunta (1 a 100)"><Input type="number" min={1} max={100} step={1} value={question.weight} onChange={event => update(index, { weight: Number(event.target.value) })} /></EditorField>
      <EditorField label="Orientação de correção (opcional, somente para a gestão)"><Textarea maxLength={10000} rows={3} value={question.grading_notes} onChange={event => update(index, { grading_notes: event.target.value })} /></EditorField>
    </section>)}
    <Button type="button" variant="outline" disabled={config.questions.length >= 100} onClick={() => onChange({ questions: [...config.questions, { id: crypto.randomUUID(), text: "", weight: 1, grading_notes: "" }] })}><Plus className="size-4" />Adicionar pergunta</Button>
  </div>
}
