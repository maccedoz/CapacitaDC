"use client"

import { BookOpen, Calendar, CheckCircle2, ChevronDown, ChevronUp, Clock, Gamepad2, Lock, Pencil, Trash2, Unlock } from "lucide-react"
import { asUtcDate, utcToLocalInput } from "@/lib/datetime"
import { NodeActivityLink } from "@/components/dashboard/node-activity-link"
import { useDashboard } from "@/components/dashboard/dashboard-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { TrainingNode } from "@/features/nodes/types"

function getNodeStatus(node: TrainingNode) {
  if (!node.is_released) return { label: "Bloqueado", color: "text-rose-400 light:text-rose-700 border-rose-500/30", icon: Lock }
  if (node.released_at) {
    const releaseDate = asUtcDate(node.released_at)
    if (releaseDate > new Date()) return { label: `Agendado`, color: "text-amber-400 light:text-amber-700 border-amber-500/30", icon: Clock }
  }
  return { label: "Liberado", color: "text-emerald-400 light:text-emerald-700 border-emerald-500/30", icon: CheckCircle2 }
}

interface NodeReleaseCardProps {
  node: TrainingNode
  releaseTimeZone: string
  onEdit: () => void
}

/** Cartão de um nó na aba Trilha: ordem, vínculo, liberação/agendamento e exclusão. */
export function NodeReleaseCard({ node, releaseTimeZone, onEdit }: NodeReleaseCardProps) {
  const { materials: { materials }, activities: { activities }, nodes: nodeState } = useDashboard()
  const { nodeReleaseState, savingNodeIds, updateReleaseLocal, saveNodeRelease, moveNode, deleteNode, refresh: refreshNodes } = nodeState

  const localState = nodeReleaseState[node.id] || {
    isReleased: node.is_released,
    scheduledDate: node.released_at ? utcToLocalInput(node.released_at) : "",
  }
  const { label, color, icon: StatusIcon } = getNodeStatus(node)
  // Os dois lados no formato local do datetime-local, para comparar corretamente.
  const isDirty = localState.isReleased !== node.is_released
    || (localState.scheduledDate || "") !== (node.released_at ? utcToLocalInput(node.released_at) : "")

  const handleDeleteNode = async () => {
    if (!confirm("Tem certeza que deseja excluir este nó da trilha?")) return
    try { await deleteNode(node.id) } catch (e: any) { alert(e.message || "Erro ao excluir nó") }
  }

  const handleSaveNodeRelease = async () => {
    try { await saveNodeRelease(node.id) } catch (e: any) { alert(e.message || "Erro ao atualizar liberação do nó") }
  }

  const handleMoveNode = async (direction: "up" | "down") => {
    try { await moveNode(node.id, direction, node.eixo) } catch (e: any) { console.error(e) }
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`p-1.5 rounded-lg ${node.type === "game" ? "bg-violet-500/10" : "bg-primary/10"}`}>
              {node.type === "game"
                ? <Gamepad2 className="h-4 w-4 text-violet-400 light:text-violet-700" />
                : <BookOpen className="h-4 w-4 text-primary" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-sm font-semibold text-foreground truncate">
                {node.name}
              </CardTitle>
              {node.type !== "material" && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {node.is_required === false ? "Opcional" : `Obrigatória · peso ${node.weight ?? 1}`} · {node.allow_retry === false ? "Sem repetição" : "Repetição permitida"}
                </p>
              )}
              {node.deadline && (
                <p className="text-[10px] text-amber-400 light:text-amber-700 flex items-center gap-1 mt-0.5 font-medium">
                  <Clock className="h-3 w-3" /> Prazo: {asUtcDate(node.deadline).toLocaleString("pt-BR")}
                </p>
              )}
            </div>
            <div className="flex items-center shrink-0 ml-1">
              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={() => handleMoveNode("up")}>
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={() => handleMoveNode("down")}>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <Badge variant="outline" className={`text-[10px] shrink-0 flex items-center gap-1 ${color}`}>
            <StatusIcon className="h-3 w-3" />
            {label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button size="sm" variant="outline" onClick={onEdit}><Pencil className="mr-2 size-4" />Editar nó</Button>
        {node.type !== "game" && <NodeActivityLink
          key={`${node.id}-${node.activity_id || "none"}`}
          node={node} activities={activities} materials={materials} onSaved={refreshNodes} />}
        {/* Toggle liberação */}
        <div className="flex items-center justify-between">
          <Label htmlFor={`release-${node.id}`} className="text-sm text-muted-foreground flex items-center gap-2 cursor-pointer">
            {localState.isReleased
              ? <Unlock className="h-3.5 w-3.5 text-emerald-400 light:text-emerald-700" />
              : <Lock className="h-3.5 w-3.5 text-rose-400 light:text-rose-700" />
            }
            {localState.isReleased ? "Liberado" : "Bloqueado"}
          </Label>
          <Switch
            id={`release-${node.id}`}
            checked={localState.isReleased}
            onCheckedChange={(checked) => updateReleaseLocal(node.id, { isReleased: checked })}
          />
        </div>

        {/* Campo de agendamento (só se liberado) */}
        {localState.isReleased && (
          <div className="space-y-1.5">
            <Label htmlFor={`release-date-${node.id}`} className="text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Data/hora de liberação (opcional)
            </Label>
            <div className="flex gap-1.5">
              <Input
                id={`release-date-${node.id}`}
                type="datetime-local"
                value={localState.scheduledDate}
                onChange={(e) => updateReleaseLocal(node.id, { scheduledDate: e.target.value })}
                className="bg-secondary border-border text-xs h-8 flex-1"
              />
              {localState.scheduledDate && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-rose-400 light:text-rose-700 hover:text-rose-300 light:hover:text-rose-800 text-[10px] shrink-0"
                  onClick={() => updateReleaseLocal(node.id, { scheduledDate: "" })}
                >
                  Limpar
                </Button>
              )}
            </div>
            {node.released_at && (
              <p className="text-[10px] text-amber-400/80 light:text-amber-700/80 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Agendado: {asUtcDate(node.released_at).toLocaleString("pt-BR")}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground">
              Horário local{releaseTimeZone ? ` (${releaseTimeZone})` : " do seu dispositivo"}.
              {" "}
              Vazio = libera imediatamente ao salvar
            </p>
          </div>
        )}

        {/* Botões salvar e excluir */}
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            variant={isDirty ? "default" : "outline"}
            disabled={savingNodeIds.has(node.id) || !isDirty}
            onClick={handleSaveNodeRelease}
          >
            {savingNodeIds.has(node.id) ? "Salvando…" : isDirty ? "Salvar" : "Salvo"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-rose-400 light:text-rose-700 hover:text-rose-300 light:hover:text-rose-800 h-9 w-9 p-0"
            onClick={handleDeleteNode}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
