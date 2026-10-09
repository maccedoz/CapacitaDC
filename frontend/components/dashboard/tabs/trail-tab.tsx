"use client"

import { useEffect, useState } from "react"
import { Compass, Plus } from "lucide-react"
import { groupByEixo } from "@/lib/roles"
import { NodeEditDialog } from "@/components/dashboard/node-edit-dialog"
import { NodeCreateForm } from "@/components/dashboard/node-create-form"
import { NodeReleaseCard } from "@/components/dashboard/node-release-card"
import { useDashboard } from "@/components/dashboard/dashboard-context"
import { Button } from "@/components/ui/button"
import type { TrainingNode } from "@/features/nodes/types"

export function TrailTab() {
  const { isOrg, materials: { materials }, activities: { activities }, nodes: { nodes, refresh: refreshNodes } } = useDashboard()
  const [showNodeForm, setShowNodeForm] = useState(false)
  const [editingNode, setEditingNode] = useState<TrainingNode | null>(null)
  const [releaseTimeZone, setReleaseTimeZone] = useState("")
  useEffect(() => {
    setReleaseTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  }, [])

  const filteredNodes = isOrg ? nodes.filter(n => n.eixo === "trainee") : nodes
  const nodeGroups = groupByEixo(filteredNodes).map(group => ({
    ...group, items: [...group.items].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)),
  }))

  return (
    <>
      {editingNode && <NodeEditDialog key={editingNode.id} node={editingNode} nodes={nodes} activities={activities} materials={materials} onClose={() => setEditingNode(null)} onSaved={refreshNodes} />}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold text-foreground">Gerenciamento da Trilha</h2>
          <p className="text-muted-foreground text-sm">Crie o material na biblioteca, vincule-o a uma atividade e selecione a atividade no nó.</p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setShowNodeForm(v => !v)}>
          <Plus className="h-4 w-4" />Novo Nó
        </Button>
      </div>

      {showNodeForm && <NodeCreateForm onClose={() => setShowNodeForm(false)} />}

      {nodes.length === 0 && !showNodeForm ? (
        <div className="text-center py-16 text-muted-foreground">
          <Compass className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhum nó de trilha cadastrado ainda. Clique em “Novo Nó” para começar.</p>
        </div>
      ) : nodes.length > 0 ? (
        <div className="space-y-8">
          {nodeGroups.map(({ eixo, label, items }) => (
            <div key={eixo} className="space-y-3">
              <h3 className="text-base font-semibold text-foreground border-b border-border pb-2">
                {label}
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((node) => (
                  <NodeReleaseCard key={node.id} node={node} releaseTimeZone={releaseTimeZone} onEdit={() => setEditingNode(node)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}
