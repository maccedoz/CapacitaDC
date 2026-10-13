"use client"

import { ExternalLink } from "lucide-react"
import { axisLabel } from "@/lib/roles"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/components/dashboard/dashboard-context"

function GradesTable({ rows, showAxis }: { rows: any[]; showAxis: boolean }) {
  return (
    <div className="rounded-xl border border-border overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-secondary/50">
            <th className="text-left p-3 font-semibold text-muted-foreground">Nome</th>
            {showAxis && <th className="text-left p-3 font-semibold text-muted-foreground">Eixo</th>}
            <th className="text-center p-3 font-semibold text-muted-foreground">Trilha %</th>
            <th className="text-center p-3 font-semibold text-muted-foreground">Atividades</th>
            <th className="text-center p-3 font-semibold text-muted-foreground">Média Ponderada</th>
            <th className="p-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row: any) => (
            <tr key={row.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
              <td className="p-3 font-medium text-foreground">{row.name}</td>
              {showAxis && <td className="p-3 text-muted-foreground">{axisLabel(row.eixo)}</td>}
              <td className="p-3 text-center">
                {row.nodes_total > 0
                  ? <span className={row.nodes_completed / row.nodes_total >= 0.8 ? "text-emerald-400 light:text-emerald-700 font-semibold" : "text-muted-foreground"}>
                      {Math.round((row.nodes_completed / row.nodes_total) * 100)}%
                    </span>
                  : <span className="text-muted-foreground/40">—</span>
                }
              </td>
              <td className="p-3 text-center text-muted-foreground">
                {row.activities_graded}/{row.activities_submitted}
              </td>
              <td className="p-3 text-center">
                {row.nota_rotacao != null
                  ? <span className={`font-bold ${row.nota_rotacao >= 7 ? "text-emerald-400 light:text-emerald-700" : row.nota_rotacao >= 5 ? "text-amber-400 light:text-amber-700" : "text-rose-400 light:text-rose-700"}`}>
                      {row.nota_rotacao.toFixed(2)}
                    </span>
                  : <span className="text-muted-foreground/40">—</span>
                }
              </td>
              <td className="p-3 text-right">
                <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-primary" onClick={() => window.open(`/perfil/${row.id}`)}>
                  <ExternalLink className="h-3 w-3" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function GradesTab() {
  const { isManager, isOrg, axisName, users } = useDashboard()
  const { grades } = users
  const memberGrades = grades.filter((g: any) => g.type === "membro")

  return (
    <>
      <p className="text-sm text-muted-foreground">A média reúne as melhores notas das atividades e dos jogos obrigatórios, conforme seus pesos. Ela é parcial enquanto houver entregas aguardando correção ou jogos por concluir.</p>
      <div className="space-y-1">
        <h2 className="text-2xl font-bold text-foreground">Planilha de Notas</h2>
        <p className="text-muted-foreground text-sm">
          {isManager
            ? `Membros de ${axisName} contam apenas a trilha deste eixo; trainees divididos por rotação.`
            : "Visão consolidada de desempenho. Trainees divididos por rotação."}
        </p>
      </div>

      {[1, 2, null].map((rot) => {
        const filtered = grades.filter((g: any) => g.type === "trainee" && (rot === null ? !g.rotacao : g.rotacao === rot))
        if (filtered.length === 0) return null
        return (
          <div key={String(rot)} className="space-y-3">
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full inline-block ${rot === 1 ? "bg-sky-400" : rot === 2 ? "bg-violet-400" : "bg-muted-foreground"}`} />
              Trainees — {rot ? `Rotação ${rot}` : "Sem Rotação"}
            </h3>
            <GradesTable rows={filtered} showAxis={false} />
          </div>
        )
      })}

      {!isOrg && memberGrades.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-foreground">{isManager ? `Membros — ${axisName}` : "Membros de Comercial"}</h3>
          <GradesTable rows={memberGrades} showAxis />
        </div>
      )}
    </>
  )
}
