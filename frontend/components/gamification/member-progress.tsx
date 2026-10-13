"use client"

import { useMemo, useState } from "react"
import { Compass, Flag, Footprints, Globe, Lock, RotateCcw, Sparkles, Star, Target, Trophy, Zap, type LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { axisLabel } from "@/lib/roles"
import type { GamificationSummary, RankingEntry } from "@/features/gamification/types"

const ICONS: Record<string, LucideIcon> = {
  first_step: Footprints, perfect_grade: Star, persistent: RotateCcw, consistent: Target, trail_complete: Flag,
  hat_trick: Trophy, first_try: Zap, halfway: Compass, explorer: Globe, all_trails: Sparkles,
}
const points = (value: number) => `${value.toLocaleString("pt-BR")} ${value === 1 ? "ponto" : "pontos"}`

/** Positions within the shown list, so an axis ranking starts at 1 with shared ties. */
function ranked(rows: RankingEntry[]) {
  return rows.map(row => ({ ...row, position: rows.findIndex(other => other.points === row.points) + 1 }))
}

export function LevelBadge({ summary }: { summary: GamificationSummary | null }) {
  if (!summary) return null
  return <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-300">
    <Trophy className="size-3" />Nível {summary.level.number} · {summary.points.toLocaleString("pt-BR")} pts
  </Badge>
}

export function MemberProgress({ summary, loading, error, onRetry }: {
  summary: GamificationSummary | null; loading: boolean; error: string | null; onRetry: () => void
}) {
  const [scope, setScope] = useState<"eixo" | "geral">("eixo")
  const axis = summary?.eixo ?? null
  const shown = scope === "eixo" && axis ? "eixo" : "geral"
  const rows = useMemo(() => {
    if (!summary) return []
    return ranked(shown === "eixo" ? summary.ranking.filter(row => row.eixo === axis) : summary.ranking)
  }, [summary, shown, axis])

  if (!summary) {
    return error
      ? <div role="alert" className="space-y-3"><p className="text-destructive">{error}</p><Button variant="outline" onClick={onRetry}>Tentar novamente</Button></div>
      : <p role="status" className="text-muted-foreground">{loading ? "Carregando sua pontuação…" : "Sem dados de pontuação."}</p>
  }

  const { level } = summary
  const span = level.next_points == null ? 0 : level.next_points - level.min_points
  const toNext = level.next_points == null ? 0 : level.next_points - summary.points
  const earned = summary.achievements.filter(item => item.earned).length

  return <div className="space-y-8">
    <Card className="border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-transparent">
      <CardContent className="flex flex-col gap-6 pt-6 sm:flex-row sm:items-center">
        <div className="flex size-20 shrink-0 flex-col items-center justify-center rounded-2xl bg-amber-500/15 text-amber-700 dark:text-amber-300">
          <span className="text-xs font-semibold uppercase">Nível</span>
          <span className="text-3xl font-extrabold leading-none">{level.number}</span>
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-xl font-bold">{level.name}</h3>
            <p className="text-lg font-semibold">{points(summary.points)}</p>
          </div>
          {level.next_points != null ? <>
            <Progress value={span ? (summary.points - level.min_points) / span * 100 : 0} aria-label="Progresso até o próximo nível" />
            <p className="text-sm text-muted-foreground">Faltam {points(toNext)} para o nível {level.number + 1}.</p>
          </> : <p className="text-sm text-muted-foreground">Você chegou ao nível máximo.</p>}
          <p className="text-xs text-muted-foreground">Cada jogo ou entrega corrigida vale a sua nota × 10 pontos (conta a melhor nota).</p>
        </div>
      </CardContent>
    </Card>

    <section className="space-y-3" aria-labelledby="achievements-title">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="achievements-title" className="text-lg font-bold">Conquistas</h3>
        <span className="text-sm text-muted-foreground">{earned} de {summary.achievements.length}</span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {summary.achievements.map(item => {
          const Icon = ICONS[item.id] ?? Trophy
          return <li key={item.id} data-achievement={item.id} data-earned={item.earned}
            className={`flex gap-3 rounded-xl border p-4 ${item.earned ? "border-amber-500/40 bg-amber-500/5" : "opacity-70"}`}>
            <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${item.earned ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>
              {item.earned ? <Icon className="size-5" /> : <Lock className="size-4" />}
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-semibold">{item.title} <span className="sr-only">{item.earned ? "(conquistada)" : "(ainda não conquistada)"}</span></p>
              <p className="text-sm text-muted-foreground">{item.description}</p>
              {item.progress && !item.earned && <>
                <Progress value={item.progress.current / item.progress.target * 100} className="h-1.5" aria-label={`${item.title}: ${item.progress.current} de ${item.progress.target}`} />
                <p className="text-xs text-muted-foreground">{item.progress.current} de {item.progress.target}</p>
              </>}
            </div>
          </li>
        })}
      </ul>
    </section>

    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-lg">Ranking dos membros</CardTitle>
        {axis && <div className="flex gap-1" role="group" aria-label="Escopo do ranking">
          <Button size="sm" variant={shown === "eixo" ? "default" : "outline"} aria-pressed={shown === "eixo"} onClick={() => setScope("eixo")}>{axisLabel(axis)}</Button>
          <Button size="sm" variant={shown === "geral" ? "default" : "outline"} aria-pressed={shown === "geral"} onClick={() => setScope("geral")}>Geral</Button>
        </div>}
      </CardHeader>
      <CardContent>
        <ol className="divide-y" aria-label={shown === "eixo" ? `Ranking de ${axisLabel(axis)}` : "Ranking geral"}>
          {rows.map(row => <li key={row.user_id} data-me={row.is_me}
            className={`flex items-center gap-3 py-2.5 ${row.is_me ? "-mx-2 rounded-lg bg-primary/10 px-2 font-semibold" : ""}`}>
            <span className="w-8 text-center text-sm font-bold tabular-nums">{row.position}º</span>
            <span className="min-w-0 flex-1 truncate">{row.name}{row.is_me && " (você)"}</span>
            {shown === "geral" && row.eixo && <span className="hidden text-xs text-muted-foreground sm:inline">{axisLabel(row.eixo)}</span>}
            <span className="text-xs text-muted-foreground">Nível {row.level}</span>
            <span className="w-24 text-right text-sm tabular-nums">{row.points.toLocaleString("pt-BR")} pts</span>
          </li>)}
        </ol>
      </CardContent>
    </Card>
  </div>
}
