"use client"

import { useState } from "react"
import { Clock } from "lucide-react"
import { AssessmentSettings } from "@/components/activities/assessment-settings"
import type { ContentItem } from "@/components/dashboard/content-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { MemberAxis } from "@/lib/roles"

export interface ActivityFormValues {
  title: string
  description: string
  eixo: string
  accepts_file: boolean
  /** Valor de um input datetime-local, no horário do navegador. */
  deadline: string
  material_id: string
  weight: number
  allow_retry: boolean
  is_required: boolean
}

export function emptyActivityForm(eixo: string): ActivityFormValues {
  return { title: "", description: "", eixo, accepts_file: true, deadline: "", material_id: "", weight: 1, allow_retry: true, is_required: true }
}

interface ActivityFormProps {
  /** Criação escolhe o público; edição mantém o eixo e ajusta o prazo. */
  mode: "create" | "edit"
  initial: ActivityFormValues
  contents: ContentItem[]
  axis: MemberAxis | null
  axisName: string
  isOrg: boolean
  onCancel: () => void
  onSubmit: (values: ActivityFormValues) => Promise<void>
}

/** Formulário de atividade, usado na criação (cartão próprio) e na edição (dentro do cartão da atividade). */
export function ActivityForm({ mode, initial, contents, axis, axisName, isOrg, onCancel, onSubmit }: ActivityFormProps) {
  const [form, setForm] = useState(initial)
  const create = mode === "create"
  const field = create ? "bg-secondary border-border" : "bg-secondary border-border text-xs h-8"
  const select = `w-full ${create ? "h-9" : "h-8"} rounded-md border border-border bg-secondary px-3 text-xs text-foreground`
  const isManager = axis !== null

  const materialOptions = create
    ? contents.filter(c => {
        if (form.eixo === "all") return true
        if (form.eixo === "trainee") return c.type === "trainee"
        return c.eixo === form.eixo
      })
    : contents

  const assessment = (
    <div className="sm:col-span-2">
      <AssessmentSettings value={form} onChange={settings => setForm(previous => ({ ...previous, ...settings }))} />
    </div>
  )

  return (
    <div className={create ? "space-y-4" : "border-t border-primary/30 pt-4 space-y-3"}>
      {create
        ? <h3 className="text-sm font-bold text-foreground">Nova Atividade</h3>
        : <h4 className="text-xs font-bold text-primary">Editar Atividade</h4>}
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${create ? "gap-4" : "gap-3"}`}>
        <div className="space-y-1 sm:col-span-2">
          <label className="text-xs text-muted-foreground">Título *</label>
          <Input
            placeholder={create ? "Ex: Relatório de Prospecção" : undefined}
            value={form.title}
            onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            className={field}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label className="text-xs text-muted-foreground">Descrição</label>
          <Input
            placeholder={create ? "Instruções da atividade..." : undefined}
            value={form.description}
            onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            className={field}
          />
        </div>

        {create && (
          <div className="space-y-1">
            <label htmlFor="activity-axis" className="text-xs text-muted-foreground">Eixo / Público</label>
            <select
              id="activity-axis"
              value={form.eixo}
              onChange={e => setForm(p => ({ ...p, eixo: e.target.value, material_id: "" }))}
              className={select}
            >
              {axis && <option value={axis}>Membros — {axisName}</option>}
              <option value="trainee">Trainees</option>
              {!isOrg && !isManager && (
                <>
                  <option value="vendas">Membros — Vendas</option>
                  <option value="conexoes">Membros — Conexões</option>
                  <option value="experiencia">Membros — Experiência</option>
                  <option value="all">Todos</option>
                </>
              )}
            </select>
          </div>
        )}

        {!create && assessment}

        <div className="space-y-1">
          <label htmlFor={create ? "activity-material" : "activity-material-edit"} className="text-xs text-muted-foreground">
            {create ? "Material da atividade (opcional)" : "Material Relacionado"}
          </label>
          <select
            id={create ? "activity-material" : "activity-material-edit"}
            value={form.material_id}
            onChange={e => setForm(p => ({ ...p, material_id: e.target.value }))}
            className={select}
          >
            <option value="">Nenhum</option>
            {materialOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {create && assessment}

        {!create && (
          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Prazo</label>
            <Input
              type="datetime-local"
              value={form.deadline}
              onChange={e => setForm(p => ({ ...p, deadline: e.target.value }))}
              className={field}
            />
          </div>
        )}

        <div className={`flex items-center ${create ? "gap-3 pt-6" : "gap-2"}`}>
          <input
            type="checkbox"
            id={create ? "accepts_file_check" : "accepts_file_edit"}
            checked={form.accepts_file}
            onChange={e => setForm(p => ({ ...p, accepts_file: e.target.checked }))}
            className="rounded"
          />
          <label htmlFor={create ? "accepts_file_check" : "accepts_file_edit"} className="text-xs text-muted-foreground cursor-pointer">
            Exige pelo menos um anexo
          </label>
        </div>
      </div>
      <div className={`flex gap-2 justify-end ${create ? "pt-2" : "pt-1"}`}>
        <Button variant="outline" size="sm" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" onClick={() => void onSubmit(form)} disabled={!form.title}>
          {create ? "Criar Atividade" : "Salvar"}
        </Button>
      </div>
    </div>
  )
}
