"use client"

import { useId } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

export interface AssessmentValues { allow_retry: boolean; is_required: boolean; weight: number }

export function AssessmentSettings({ value, onChange }: { value: AssessmentValues; onChange: (value: AssessmentValues) => void }) {
  const id = useId()
  return <div className="space-y-4 rounded-lg border p-4">
    <div className="flex items-center justify-between gap-4"><Label htmlFor={`${id}-retry`}>Permitir repetição</Label><Switch id={`${id}-retry`} checked={value.allow_retry} onCheckedChange={allow_retry => onChange({ ...value, allow_retry })} /></div>
    <p className="text-xs text-muted-foreground">{value.allow_retry ? "Pode tentar novamente. A melhor nota será mantida." : "Apenas uma entrega ou tentativa concluída por participante."}</p>
    <div className="flex items-center justify-between gap-4"><Label htmlFor={`${id}-required`}>Obrigatória (vale nota)</Label><Switch id={`${id}-required`} checked={value.is_required} onCheckedChange={is_required => onChange({ ...value, is_required, weight: is_required && value.weight <= 0 ? 1 : value.weight })} /></div>
    {value.is_required ? <div className="space-y-2"><Label htmlFor={`${id}-weight`}>Peso da nota</Label><Input id={`${id}-weight`} type="number" required min="0.1" step="0.1" value={value.weight}
      // Rolar até Salvar não pode incrementar ou decrementar o peso por acidente.
      onWheel={event => event.currentTarget.blur()}
      onChange={event => onChange({ ...value, weight: Number(event.target.value) })} /><p className="text-xs text-muted-foreground">Nota de 0 a 10. O peso deve ser maior que zero e define a participação na média.</p></div>
      : <p className="text-xs text-muted-foreground">Atividade opcional: não entra na média ponderada.</p>}
  </div>
}
