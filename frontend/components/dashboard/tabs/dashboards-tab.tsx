"use client"

import { useEffect, useState } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { BarChart3, Loader2 } from "lucide-react"
import { useDashboard } from "@/components/dashboard/dashboard-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Label } from "@/components/ui/label"
import { dashboardApi } from "@/features/dashboard/api"
import type { DashboardOverview, QuestionStats } from "@/features/dashboard/types"
import { axisLabel } from "@/lib/roles"

const trailName = (trail: string) => trail === "trainee" ? "Trainee (PlugInfo)" : axisLabel(trail)
const percentage = (rate: number | null) => rate === null ? "—" : `${(rate * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
const grade = (value: number | null) => value === null ? "—" : value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
const selectClass = "h-9 max-w-full rounded-md border border-border bg-secondary px-3 text-sm"

export function DashboardsTab() {
  const { axis } = useDashboard()
  const [trail, setTrail] = useState<string>(axis ?? "trainee")
  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const [gameId, setGameId] = useState("")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError("")
    dashboardApi.overview(trail).then(data => {
      if (!cancelled) setOverview(data)
    }).catch(cause => {
      if (!cancelled) { setOverview(null); setError(cause instanceof Error ? cause.message : "Não foi possível carregar os dashboards.") }
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [trail, reload])

  const selectedGame = overview?.games.find(game => game.node_id === gameId)?.node_id ?? overview?.games[0]?.node_id ?? ""

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold">Dashboards</h2>
        <p className="text-sm text-muted-foreground">Conclusão das etapas e resultados dos jogos no público de cada trilha.</p>
      </div>
      <div className="flex items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="dashboard-trail">Trilha</Label>
          <select id="dashboard-trail" className={selectClass} value={trail} onChange={event => { setTrail(event.target.value); setGameId("") }}>
            {(overview?.trails ?? [trail]).map(value => <option key={value} value={value}>{trailName(value)}</option>)}
          </select>
        </div>
        <Button variant="outline" disabled={loading} onClick={() => setReload(value => value + 1)}>Atualizar</Button>
      </div>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {loading ? <p role="status" className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" />Carregando dashboards…</p> : overview && <>
      <p className="text-sm text-muted-foreground">{overview.participants} {overview.participants === 1 ? "participante" : "participantes"} em {trailName(trail)}.{" "}
        {overview.participants === 0 && "Os percentuais ficam disponíveis quando houver participantes."}</p>
      <Card>
        <CardHeader><CardTitle>Conclusão por etapa</CardTitle><CardDescription>Etapas liberadas, na ordem da trilha. Conta apenas o público desta trilha.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <MetricChart title="Percentual de conclusão por etapa" rows={overview.steps.map(item => ({ id: item.node_id, name: item.name, value: item.rate === null ? null : item.rate * 100 }))} max={100} suffix="%" />
          <Numbers headers={["Etapa", "Concluíram", "Conclusão"]} rows={overview.steps.map(item => [item.node_id, item.name, `${item.completed} de ${item.total}`, percentage(item.rate)])} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Média por jogo</CardTitle><CardDescription>Melhor nota de cada participante, do jogo mais difícil para o mais fácil. Aprovados: nota 7 ou mais.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <MetricChart title="Média das melhores notas por jogo" rows={overview.games.map(item => ({ id: item.node_id, name: item.name, value: item.average }))} max={10} suffix="" />
          <Numbers headers={["Jogo", "Jogaram", "Média", "Aprovados"]} rows={overview.games.map(item => [item.node_id, item.name, `${item.played} de ${item.total}`, grade(item.average), percentage(item.approved_rate)])} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Acerto por questão</CardTitle><CardDescription>Primeira tentativa concluída de cada pessoa por versão publicada, sem contar as repetições.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {overview.games.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum jogo nesta trilha.</p> : <>
            <div className="space-y-1"><Label htmlFor="dashboard-game">Jogo</Label>
              <select id="dashboard-game" className={selectClass} value={selectedGame} onChange={event => setGameId(event.target.value)}>
                {overview.games.map(item => <option key={item.node_id} value={item.node_id}>{item.name}</option>)}
              </select>
            </div>
            <QuestionDetails key={`${trail}:${selectedGame}:${reload}`} nodeId={selectedGame} />
          </>}
        </CardContent>
      </Card>
    </>}
  </div>
}

function QuestionDetails({ nodeId }: { nodeId: string }) {
  const [stats, setStats] = useState<QuestionStats | null>(null)
  const [error, setError] = useState("")
  const [version, setVersion] = useState("")
  useEffect(() => {
    let cancelled = false
    dashboardApi.questions(nodeId).then(data => { if (!cancelled) setStats(data) })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Não foi possível carregar as questões.") })
    return () => { cancelled = true }
  }, [nodeId])
  if (error) return <p role="alert" className="text-destructive">{error}</p>
  if (!stats) return <p role="status" className="text-sm text-muted-foreground">Carregando questões…</p>
  if (!stats.available) return <p className="text-sm text-muted-foreground">Este questionário antigo não guarda acerto por questão. A média do jogo continua disponível.</p>
  if (!stats.revisions.length) return <p className="text-sm text-muted-foreground">Nenhuma tentativa concluída por participantes desta trilha.</p>
  const revision = stats.revisions.find(item => item.revision_id === version) ?? stats.revisions[0]
  return <div className="space-y-4">
    <div className="space-y-1"><Label htmlFor="dashboard-version">Versão publicada</Label>
      <select id="dashboard-version" className={selectClass} value={revision.revision_id} onChange={event => setVersion(event.target.value)}>
        {stats.revisions.map(item => <option key={item.revision_id} value={item.revision_id}>Versão {item.version ?? "—"} · {item.title ?? stats.name}</option>)}
      </select>
    </div>
    <p className="text-sm text-muted-foreground">{revision.attempts} primeiras tentativas · média {grade(revision.average_first_grade)}.</p>
    <MetricChart title="Taxa de acerto por questão" rows={revision.items.map(item => ({ id: item.id, name: item.text || item.id, value: item.correct_rate * 100 }))} max={100} suffix="%" />
    <Numbers headers={["Questão / item", "Respostas", "Acerto completo", "Pontos obtidos"]} rows={revision.items.map(item => [item.id, item.text || item.id, String(item.answers), percentage(item.correct_rate), percentage(item.score_rate)])} />
    <p className="text-xs text-muted-foreground">Pontos obtidos inclui o acerto parcial. Nos cenários, acerto é escolher a melhor opção daquele passo; cada passo conta apenas as pessoas que passaram por ele.</p>
  </div>
}

function MetricChart({ title, rows, max, suffix }: { title: string; rows: { id: string; name: string; value: number | null }[]; max: number; suffix: string }) {
  const available = rows.filter(row => row.value !== null)
  if (!available.length) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><BarChart3 className="size-4" />Ainda não há dados para este gráfico.</p>
  return <ChartContainer config={{ value: { label: title, color: "var(--chart-1)" } }} role="img" aria-label={title}
    className="w-full aspect-auto" style={{ height: Math.max(180, available.length * 40) }}>
    <BarChart layout="vertical" data={available} accessibilityLayer margin={{ right: 25 }}>
      <CartesianGrid horizontal={false} />
      <XAxis type="number" domain={[0, max]} tickFormatter={value => `${value}${suffix}`} />
      <YAxis type="category" dataKey="name" width={150} tickFormatter={value => value.length > 22 ? `${value.slice(0, 21)}…` : value} />
      <ChartTooltip content={<ChartTooltipContent hideLabel formatter={(value, _name, item) => <span>{item.payload.name}: {Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}{suffix}</span>} />} />
      <Bar dataKey="value" fill="var(--color-value)" radius={[0, 4, 4, 0]} maxBarSize={32} isAnimationActive={false} />
    </BarChart>
  </ChartContainer>
}

function Numbers({ headers, rows }: { headers: string[]; rows: string[][] }) {
  if (!rows.length) return null
  return <div className="overflow-x-auto"><table className="w-full text-sm">
    <caption className="sr-only">Valores do gráfico</caption>
    <thead><tr>{headers.map(header => <th key={header} scope="col" className="border-b py-2 pr-4 text-left font-medium text-muted-foreground">{header}</th>)}</tr></thead>
    <tbody>{rows.map(([id, ...cells]) => <tr key={id}>{cells.map((cell, index) => index === 0
      ? <th key={index} scope="row" className="border-b py-2 pr-4 text-left font-normal">{cell}</th>
      : <td key={index} className="border-b py-2 pr-4 tabular-nums whitespace-nowrap">{cell}</td>)}</tr>)}</tbody>
  </table></div>
}
