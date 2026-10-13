"use client"

import { BookOpen, ClipboardList, Gamepad2, Lock, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { asUtcDate } from "@/lib/datetime"

interface Question {
  id: string
  text: string
  options: any[]
}

interface TrainingNode {
  id: string
  name: string
  type: "activity" | "material" | "game"
  reference_id?: string | null
  activity_id?: string | null
  deadline?: string | null
  order_index?: number
  eixo: string
  prerequisite_node_id?: string | null
  /** Corrente que vale de fato, calculada pelo servidor. */
  effective_prerequisite_id?: string | null
  x_pos?: number | null
  y_pos?: number | null
  completed: boolean
  pending_review?: boolean
  unlocked: boolean
  user_score: number
  grade?: number | null
  weight?: number
  is_required?: boolean
  allow_retry?: boolean
  questions: Question[]
  is_released?: boolean
  released_at?: string | null
}

interface TrainingPathProps {
  nodes: TrainingNode[]
  onSelectNode: (node: TrainingNode) => void
  highlighted?: boolean
  axisName?: string
}

const CONTAINER_WIDTH = 300
const STEP_X = 60
const STEP_Y = 120
const START_Y = 44
const NODE_RADIUS = 28
// A linha para na borda do nó em vez de passar por baixo dele.
const LINE_GAP = NODE_RADIUS + 6

export function TrainingPath({ nodes, onSelectNode, highlighted = false, axisName }: TrainingPathProps) {
  const sorted = [...nodes].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
  const placed = sorted.map((node, index) => ({
    ...node,
    x: CONTAINER_WIDTH / 2 + [0, 1, -1][index % 3] * STEP_X,
    y: index * STEP_Y + START_Y,
    // Sem o campo do servidor, a etapa anterior na tela mantém a linha visível.
    linkedTo: node.effective_prerequisite_id ?? node.prerequisite_node_id ?? sorted[index - 1]?.id ?? null,
  }))
  const height = (placed.at(-1)?.y ?? START_Y) + NODE_RADIUS + 24

  return (
    <div className={`relative rounded-2xl border-2 bg-card p-6 transition-all duration-300 ${
      highlighted
        ? "border-primary/50 bg-gradient-to-b from-card to-primary/5 shadow-lg shadow-primary/5"
        : "border-border shadow-sm"
    }`}>
      {axisName && (
        <div className="mb-6 flex items-center justify-between">
          <h3 className="flex items-center space-x-2 text-lg font-bold text-foreground">
            <span>Trilha: {axisName}</span>
            {highlighted && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                Seu Eixo
              </span>
            )}
          </h3>
        </div>
      )}

      {placed.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma etapa nesta trilha ainda.</p>
      ) : (
      // A caixa tem largura fixa para o cálculo das posições; em coluna estreita ela rola.
      <div className="w-full overflow-x-auto">
      <div className="relative mx-auto" style={{ width: `${CONTAINER_WIDTH}px`, height: `${height}px` }}>
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          {placed.map(node => {
            const previous = placed.find(item => item.id === node.linkedTo)
            if (!previous) return null
            const dx = node.x - previous.x
            const dy = node.y - previous.y
            const length = Math.hypot(dx, dy) || 1
            const trimX = (dx / length) * LINE_GAP
            const trimY = (dy / length) * LINE_GAP
            // Sólida quando a etapa anterior foi concluída: a linha mostra a regra real.
            const open = previous.completed
            return (
              <line key={`linha-${previous.id}-${node.id}`}
                x1={previous.x + trimX} y1={previous.y + trimY}
                x2={node.x - trimX} y2={node.y - trimY}
                stroke={open ? "var(--primary)" : "var(--border)"}
                strokeWidth={4} strokeLinecap="round"
                strokeDasharray={open ? "none" : "6,6"}
                className="trail-link transition-all duration-300" />
            )
          })}
        </svg>

        {placed.map(node => {
          let style = "bg-muted text-muted-foreground border-border"
          if (node.unlocked) {
            style = node.completed
              ? "bg-emerald-600 border-emerald-500 text-white hover:bg-emerald-700 shadow-md shadow-emerald-500/10"
              : "bg-primary border-primary text-white hover:brightness-110 shadow-md shadow-primary/20 ring-4 ring-primary/20"
          }
          const scheduled = node.is_released && node.released_at && asUtcDate(node.released_at) > new Date()
          return (
            <div key={node.id} className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${node.x}px`, top: `${node.y}px` }}>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <Button aria-label={node.name} disabled={!node.unlocked}
                        onClick={() => onSelectNode(node)}
                        className={`flex size-14 items-center justify-center rounded-full border-4 p-0 transition-all duration-200 ${style} ${
                          !node.unlocked ? "cursor-not-allowed opacity-60" : ""
                        }`}>
                        {node.completed ? <Check className="size-6 stroke-[3px]" />
                          : !node.unlocked ? <Lock className="size-5" />
                          : node.type === "material" ? <BookOpen className="size-6" />
                          : node.type === "activity" ? <ClipboardList className="size-6" />
                          : <Gamepad2 className="size-6" />}
                      </Button>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="center" className="max-w-[200px] text-center">
                    <p className="text-xs font-bold">{node.name}</p>
                    {node.pending_review && <p className="mt-1 text-xs font-semibold text-amber-400 light:text-amber-700">Aguardando correção</p>}
                    {node.type === "game" && node.completed && (
                      <p className="mt-1 text-[10px] font-semibold text-emerald-400 light:text-emerald-700">{node.grade != null ? `Nota: ${node.grade.toFixed(2)} / 10` : "Concluído"}</p>
                    )}
                    {node.type === "game" && node.unlocked && !node.completed && node.grade != null && (
                      <p className="mt-1 text-[10px] font-semibold text-amber-400 light:text-amber-700">Melhor nota: {node.grade.toFixed(2)} / 10 · tire 7 ou mais para avançar</p>
                    )}
                    {node.type === "material" && node.completed && (
                      <p className="mt-1 text-[10px] font-semibold text-emerald-400 light:text-emerald-700">Lido</p>
                    )}
                    {!node.unlocked && (
                      <p className="mt-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold text-rose-400 light:text-rose-700">
                        <span className="flex items-center gap-1"><Lock className="mr-1 size-3" />Bloqueado</span>
                        {scheduled ? (
                          <span className="text-[9px] text-amber-400 light:text-amber-700">
                            ⏰ Disponível em {asUtcDate(node.released_at!).toLocaleString("pt-BR")}
                          </span>
                        ) : node.linkedTo ? (
                          <span className="text-[9px] text-muted-foreground">Conclua a etapa anterior</span>
                        ) : null}
                      </p>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )
        })}
      </div>
      </div>
      )}
    </div>
  )
}
