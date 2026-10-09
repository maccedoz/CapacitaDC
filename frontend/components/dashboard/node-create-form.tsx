"use client"

import { useEffect, useState } from "react"
import { Clock } from "lucide-react"
import { apiClient } from "@/lib/api-client"
import { AssessmentSettings } from "@/components/activities/assessment-settings"
import { useDashboard } from "@/components/dashboard/dashboard-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { gamesApi } from "@/features/games/api"
import { gameFormatLabels } from "@/features/games/drafts"
import type { Game } from "@/features/games/types"

/** Cartão de criação de um nó da trilha (atividade ou jogo publicado). */
export function NodeCreateForm({ onClose }: { onClose: () => void }) {
  const { axis, isOrg, axisName, defaultEixo, contents, materials: { materials }, activities: { activities }, nodes: { nodes, refresh: refreshNodes }, navigate } = useDashboard()

  const [games, setGames] = useState<Game[]>([])
  const [gameRevisionId, setGameRevisionId] = useState("")
  const [prerequisiteId, setPrerequisiteId] = useState("")
  const [nodeError, setNodeError] = useState("")
  const [creatingNode, setCreatingNode] = useState(false)
  const [nodeForm, setNodeForm] = useState({
    name: "", type: "activity" as "activity" | "game", eixo: defaultEixo,
    activity_id: "", reference_id: "", deadline: "", is_released: false, allow_retry: true, is_required: true, weight: 1,
  })

  useEffect(() => {
    gamesApi.list().then(setGames).catch(error => setNodeError(error.message))
  }, [])

  const handleCreateNode = async () => {
    if (creatingNode) return
    setCreatingNode(true)
    setNodeError("")
    let deadlineIso: string | null = null
    if (nodeForm.deadline) { const d = new Date(nodeForm.deadline); if (!isNaN(d.getTime())) deadlineIso = d.toISOString() }
    const payload: any = {
      name: nodeForm.name.trim() || null, type: nodeForm.type, eixo: nodeForm.eixo,
      activity_id: nodeForm.type === "activity" ? (nodeForm.activity_id || null) : null,
      reference_id: nodeForm.type === "game" ? nodeForm.reference_id || null : null,
      deadline: deadlineIso, is_released: nodeForm.is_released,
      game_revision_id: nodeForm.type === "game" ? gameRevisionId : null,
      prerequisite_node_id: prerequisiteId || null,
      questions: [],
      ...(nodeForm.type === "game" ? { allow_retry: nodeForm.allow_retry, is_required: nodeForm.is_required, weight: nodeForm.weight } : {}),
    }
    try {
      await apiClient.post("/api/nodes", payload)
      await refreshNodes()
      onClose()
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : "Erro ao criar etapa")
    } finally {
      setCreatingNode(false)
    }
  }

  return (
    <Card className="border-primary/30 bg-card">
      <CardContent className="pt-6 space-y-4">
        <h3 className="text-sm font-bold text-foreground">Novo Nó de Trilha</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label htmlFor="node-type" className="text-xs text-muted-foreground">Tipo de Nó</label>
            <select id="node-type" value={nodeForm.type}
              onChange={e => setNodeForm(p => ({ ...p, type: e.target.value as "activity" | "game" }))}
              className="w-full h-9 rounded-md border border-border bg-secondary px-3 text-xs text-foreground">
              <option value="activity">Atividade</option>
              <option value="game">Jogo da biblioteca</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Eixo</label>
            {isOrg ? (
              <Input value="Trainee" disabled className="bg-secondary border-border text-xs h-9" />
            ) : (
              <select value={nodeForm.eixo}
                onChange={e => {
                  setNodeForm(p => ({ ...p, eixo: e.target.value, activity_id: "", reference_id: "" }))
                  setGameRevisionId("")
                  setPrerequisiteId("")
                }}
                className="w-full h-9 rounded-md border border-border bg-secondary px-3 text-xs text-foreground">
                {axis ? <>
                  <option value={axis}>{axisName}</option>
                  <option value="trainee">Trainee</option>
                </> : <>
                  <option value="trainee">Trainee</option>
                  <option value="vendas">Vendas</option>
                  <option value="conexoes">Conexões</option>
                  <option value="experiencia">Experiência</option>
                </>}
              </select>
            )}
          </div>

          {nodeForm.type === "activity" && (
            <div className="space-y-1 sm:col-span-2">
              <label htmlFor="node-activity" className="text-xs text-muted-foreground font-medium">Atividade Associada *</label>
              <select id="node-activity" value={nodeForm.activity_id}
                onChange={e => {
                  const actId = e.target.value
                  const act = activities.find(a => a.id === actId)
                  setNodeForm(p => ({ ...p, activity_id: actId, name: p.name || (act ? act.title : "") }))
                }}
                className="w-full h-9 rounded-md border border-border bg-secondary px-3 text-xs text-foreground">
                <option value="">Selecione uma atividade...</option>
                {activities
                  .filter(a => nodeForm.eixo === "all" || a.eixo === "all" || a.eixo === nodeForm.eixo)
                  .map(a => (
                    <option key={a.id} value={a.id}>{a.title} — {contents.find(c => c.id === a.material_id)?.name || "Sem material"}</option>
                  ))}
              </select>
            </div>
          )}

          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs text-muted-foreground">Nome do Nó (opcional)</label>
            <Input placeholder="Se vazio, usa o título do conteúdo selecionado" value={nodeForm.name}
              onChange={e => setNodeForm(p => ({ ...p, name: e.target.value }))}
              className="bg-secondary border-border text-xs h-9" />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> Prazo da Atividade neste Nó (opcional)
            </label>
            <Input type="datetime-local" value={nodeForm.deadline}
              onChange={e => setNodeForm(p => ({ ...p, deadline: e.target.value }))}
              className="bg-secondary border-border text-xs h-9" />
          </div>

          {nodeForm.type === "game" && (
            <div className="sm:col-span-2 space-y-2">
              <Label htmlFor="node-game">Jogo publicado</Label>
              <select id="node-game" value={gameRevisionId} onChange={e => setGameRevisionId(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-secondary px-3 text-sm">
                <option value="">Selecione um jogo...</option>
                {games.filter(game => game.published_revision && game.eixo === nodeForm.eixo).map(game => (
                  <option key={game.id} value={game.published_revision!.id}>
                    {game.published_revision!.title} — {gameFormatLabels[game.format]} (v{game.published_revision!.version})
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Publique o jogo na <button type="button" className="underline" onClick={() => navigate("atividades", "jogos")}>aba Atividades → Jogos</button> para adicioná-lo à trilha.</p>
            </div>
          )}
          {nodeForm.type === "game" && <div className="sm:col-span-2"><AssessmentSettings value={nodeForm} onChange={settings => setNodeForm(previous => ({ ...previous, ...settings }))} /></div>}
          {nodeForm.type === "game" && <div className="sm:col-span-2 space-y-2">
            <Label htmlFor="node-material">Material de apoio (opcional)</Label>
            <select id="node-material" value={nodeForm.reference_id} onChange={event => setNodeForm(previous => ({ ...previous, reference_id: event.target.value }))}
              className="w-full h-9 rounded-md border border-border bg-secondary px-3 text-sm">
              <option value="">Sem material</option>
              {materials.filter(material => material.eixo === nodeForm.eixo || material.eixo === "all").map(material => <option key={material.id} value={material.id}>{material.name}</option>)}
            </select>
          </div>}
          <div className="sm:col-span-2 space-y-2">
            <Label htmlFor="node-prerequisite">Pré-requisito</Label>
            <select id="node-prerequisite" value={prerequisiteId} onChange={e => setPrerequisiteId(e.target.value)}
              className="w-full h-9 rounded-md border border-border bg-secondary px-3 text-sm">
              <option value="">Sem pré-requisito</option>
              {nodes.filter(node => node.eixo === nodeForm.eixo).map(node => (
                <option key={node.id} value={node.id}>{node.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" id="node_released" checked={nodeForm.is_released}
              onChange={e => setNodeForm(p => ({...p, is_released: e.target.checked}))} className="rounded" />
            <label htmlFor="node_released" className="text-xs text-muted-foreground cursor-pointer">Liberar imediatamente</label>
          </div>
        </div>
        {nodeError && <p role="alert" className="text-sm text-destructive">{nodeError}</p>}
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" size="sm" disabled={creatingNode} onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={handleCreateNode} disabled={creatingNode || (
            nodeForm.type === "activity" ? !nodeForm.activity_id : !gameRevisionId
          )}>{creatingNode ? "Criando..." : "Criar Nó"}</Button>
        </div>
      </CardContent>
    </Card>
  )
}
