"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { apiClient } from "@/lib/api-client"
import { gamesApi } from "@/features/games/api"
import type { Game } from "@/features/games/types"
import type { TrainingNode } from "@/features/nodes/types"
import type { Activity } from "@/features/activities/types"
import type { Material } from "@/features/materials/types"
import { AssessmentSettings, type AssessmentValues } from "@/components/activities/assessment-settings"
import { groupByEixo } from "@/lib/roles"
import { utcToLocalInput } from "@/lib/datetime"

export function NodeEditDialog({ node, nodes, activities, materials, onClose, onSaved }: {
  node: TrainingNode; nodes: TrainingNode[]; activities: Activity[]; materials: Material[]
  onClose: () => void; onSaved: () => Promise<unknown>
}) {
  const [assessment, setAssessment] = useState<AssessmentValues>({ allow_retry: node.allow_retry !== false, is_required: node.is_required !== false, weight: node.weight ?? 1 })
  const [name, setName] = useState(node.name)
  const [deadline, setDeadline] = useState(node.deadline ? utcToLocalInput(node.deadline) : "")
  const [activityId, setActivityId] = useState(node.activity_id || node.reference_id || "")
  const [materialId, setMaterialId] = useState(node.reference_id || "")
  const [revisionId, setRevisionId] = useState(node.game_revision_id || "")
  const [prerequisiteId, setPrerequisiteId] = useState(node.prerequisite_node_id || "")
  const [games, setGames] = useState<Game[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    if (!node.game_revision_id) return
    let active = true
    gamesApi.list().then(items => { if (active) setGames(items) }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : "Não foi possível carregar os jogos.")
    })
    return () => { active = false }
  }, [node.game_revision_id])
  const inAxis = (item: { eixo: string }) => item.eixo === node.eixo || item.eixo === "all"
  const revisions = games.filter(game => game.eixo === node.eixo).flatMap(game => game.published_revision ? [game.published_revision] : [])
  const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
  const save = async () => {
    setBusy(true)
    setError("")
    try {
      await apiClient.patch(`/api/nodes/${node.id}`, {
        ...(node.type === "game" ? assessment : {}),
        name: name.trim(), deadline: deadline ? new Date(deadline).toISOString() : null,
        prerequisite_node_id: prerequisiteId || null,
        ...(node.type === "activity" ? { activity_id: activityId } : { reference_id: materialId || null }),
        ...(node.game_revision_id ? { game_revision_id: revisionId } : {}),
      })
      await onSaved()
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a etapa.") }
    finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>Editar nó</DialogTitle><DialogDescription>Atualize o nome, o conteúdo, o prazo e o pré-requisito desta etapa.</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save() }}>
        <fieldset disabled={busy} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="edit-node-name">Nome do nó</Label><Input id="edit-node-name" required value={name} onChange={event => setName(event.target.value)} /></div>
          {node.type === "activity" ? <div className="space-y-2">
            <Label htmlFor="edit-node-activity">Atividade associada</Label>
            <select id="edit-node-activity" required className={selectClass} value={activityId} onChange={event => setActivityId(event.target.value)}>
              <option value="">Selecione uma atividade</option>
              {groupByEixo(activities.filter(inAxis)).map(({ eixo, label, items }) => <optgroup key={eixo} label={label}>{items.map(activity => <option key={activity.id} value={activity.id}>{activity.title}</option>)}</optgroup>)}
            </select>
            <p className="text-sm text-muted-foreground">Material: {materials.find(material => material.id === activities.find(activity => activity.id === activityId)?.material_id)?.name || "Sem material associado"}. Altere esse vínculo na aba Atividades.</p>
          </div> : <div className="space-y-2">
            <Label htmlFor="edit-node-material">Material de apoio{node.type === "game" ? " (opcional)" : ""}</Label>
            <select id="edit-node-material" required={node.type === "material"} className={selectClass} value={materialId} onChange={event => setMaterialId(event.target.value)}>
              <option value="">Sem material</option>
              {groupByEixo(materials.filter(inAxis)).map(({ eixo, label, items }) => <optgroup key={eixo} label={label}>{items.map(material => <option key={material.id} value={material.id}>{material.name}</option>)}</optgroup>)}
            </select>
          </div>}
          {node.game_revision_id && <div className="space-y-2">
            <Label htmlFor="edit-node-game">Jogo publicado</Label>
            <select id="edit-node-game" className={selectClass} value={revisionId} onChange={event => setRevisionId(event.target.value)}>
              {!revisions.some(revision => revision.id === node.game_revision_id) && <option value={node.game_revision_id}>Versão atual da etapa</option>}
              {revisions.map(revision => <option key={revision.id} value={revision.id}>{revision.title} (v{revision.version})</option>)}
            </select>
          </div>}
          {node.type === "game" && <AssessmentSettings value={assessment} onChange={setAssessment} />}
          <div className="space-y-2"><Label htmlFor="edit-node-deadline">Prazo (opcional)</Label><Input id="edit-node-deadline" type="datetime-local" value={deadline} onChange={event => setDeadline(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="edit-node-prerequisite">Pré-requisito</Label>
            <select id="edit-node-prerequisite" className={selectClass} value={prerequisiteId} onChange={event => setPrerequisiteId(event.target.value)}>
              <option value="">Etapa anterior da trilha</option>
              {nodes.filter(item => item.eixo === node.eixo && item.id !== node.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy || !name.trim()}>{busy ? "Salvando..." : "Salvar alterações"}</Button></div>
      </form>
    </DialogContent>
  </Dialog>
}
