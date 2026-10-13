"use client"

import { useCallback, useEffect, useState } from "react"
import { Copy, Eye, Gamepad2, Layers, ListChecks, ListOrdered, Loader2, MessageSquare, Pencil, Route, Shuffle, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { groupByEixo } from "@/lib/roles"
import { gamesApi } from "@/features/games/api"
import { gameFormatLabels, gameFormatSummaries } from "@/features/games/drafts"
import type { Game, GameFormat } from "@/features/games/types"
import { GameEditor, type GameAxis } from "./game-editor"
import { GamePreviewScreen } from "./game-preview-screen"

const allAxes: GameAxis[] = [
  { value: "trainee", label: "Trainees" },
  { value: "vendas", label: "Vendas" },
  { value: "conexoes", label: "Conexões" },
  { value: "experiencia", label: "Experiência do Consumidor" },
  { value: "all", label: "Todos" },
]

const formatCards = [
  { format: "quiz" as const, icon: ListChecks, action: "Criar questionário" },
  { format: "open_response" as const, icon: MessageSquare, action: "Criar questionário aberto" },
  { format: "scenario" as const, icon: Route, action: "Criar cenário" },
  { format: "matching" as const, icon: Shuffle, action: "Criar associação" },
  { format: "ordering" as const, icon: ListOrdered, action: "Criar ordenação" },
  { format: "categorization" as const, icon: Layers, action: "Criar classificação" },
]

export function GameLibrary({ isOrganizer, managerAxis = null }: { isOrganizer: boolean; managerAxis?: string | null }) {
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [selectedAxis, setSelectedAxis] = useState("")
  const [editing, setEditing] = useState<{ key: string; game: Game | null; format: GameFormat } | null>(null)
  const [preview, setPreview] = useState<Game | null>(null)
  const [busy, setBusy] = useState(false)
  // O servidor recusa outros eixos; a lista só evita oferecer o que será recusado.
  // Para o gerente, o próprio eixo vem primeiro (é o padrão de um jogo novo).
  const axes = managerAxis ? [...allAxes.filter(axis => axis.value === managerAxis), allAxes[0]]
    : isOrganizer ? allAxes.filter(axis => axis.value === "trainee") : allAxes
  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try { setGames(await gamesApi.list()) } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar a biblioteca.") } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const changed = (game: Game) => setGames(previous => previous.some(item => item.id === game.id) ? previous.map(item => item.id === game.id ? game : item) : [game, ...previous])
  const duplicate = async (game: Game) => {
    setBusy(true)
    setError("")
    try {
      const copy = await gamesApi.duplicate(game.id)
      changed(copy)
      setEditing({ key: copy.id, game: copy, format: copy.format })
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível duplicar o jogo.") } finally { setBusy(false) }
  }
  const remove = async (game: Game) => {
    if (!confirm(`Excluir "${game.title || "Jogo sem título"}"? Esta ação não pode ser desfeita.`)) return
    setBusy(true)
    setError("")
    try {
      await gamesApi.remove(game.id)
      setGames(previous => previous.filter(item => item.id !== game.id))
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível excluir o jogo.") } finally { setBusy(false) }
  }
  if (editing) return <GameEditor key={editing.key} game={editing.game} format={editing.format} axes={axes} onChanged={changed} onClose={() => setEditing(null)} />

  if (preview) return <GamePreviewScreen draft={preview} onClose={() => setPreview(null)} backLabel="Voltar aos jogos" />

  const filtered = games.filter(game => (!selectedAxis || game.eixo === selectedAxis) && `${game.title} ${gameFormatLabels[game.format]} ${game.eixo}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")))
  return <div className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {formatCards.map(({ format, icon: Icon, action }) => <div key={format} className="space-y-3 rounded-xl border bg-card p-5">
        <Icon className="size-7 text-primary" />
        <h2 className="font-semibold">{gameFormatLabels[format]}</h2>
        <p className="text-sm text-muted-foreground">{gameFormatSummaries[format]}</p>
        <Button variant="outline" onClick={() => setEditing({ key: crypto.randomUUID(), game: null, format })}>{action}</Button>
      </div>)}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Jogos da biblioteca</h2><select aria-label="Filtrar jogos por eixo" className="h-9 max-w-full rounded-md border bg-secondary px-3 text-sm" value={selectedAxis} onChange={event => setSelectedAxis(event.target.value)}><option value="">Todos os públicos</option>{axes.map(axis => <option key={axis.value} value={axis.value}>{axis.label}</option>)}</select><Input aria-label="Buscar jogos" className="max-w-sm" placeholder="Buscar por título, formato ou eixo" value={query} onChange={event => setQuery(event.target.value)} /></div>
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 p-4 text-sm"><span className="text-destructive">{error}</span><Button variant="outline" size="sm" onClick={() => void load()}>Tentar novamente</Button></div>}
    {loading ? <p role="status" className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="size-4 animate-spin" />Carregando biblioteca…</p> : !filtered.length ? <div className="rounded-xl border border-dashed p-10 text-center"><Gamepad2 className="mx-auto mb-3 size-10 text-muted-foreground" /><p className="font-medium">{games.length ? "Nenhum jogo encontrado" : "Sua biblioteca está vazia"}</p><p className="mt-2 text-sm text-muted-foreground">{games.length ? "Experimente outro termo de busca." : "Escolha um formato acima e preencha seu primeiro rascunho."}</p></div> : <div className="space-y-8">{groupByEixo(filtered).map(({ eixo, label, items }) => <section key={eixo} className="space-y-4" aria-label={`Jogos — ${label}`}><h3 className="border-b pb-2 text-base font-semibold">{label}</h3><div className="grid gap-4 md:grid-cols-2">{items.map(game => <article key={game.id} className="flex flex-col gap-4 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap gap-2"><Badge variant="secondary">{gameFormatLabels[game.format]}</Badge><Badge variant="outline">{allAxes.find(axis => axis.value === game.eixo)?.label || game.eixo}</Badge></div>
      <div><h3 className="text-lg font-semibold">{game.title || "Jogo sem título"}</h3><p className="mt-1 text-sm text-muted-foreground">{game.published_revision ? `Versão ${game.published_revision.version} publicada${game.has_unpublished_changes ? " · alterações em rascunho" : ""}` : "Rascunho · publique para adicionar à trilha"}</p></div>
      {game.instructions && <p className="line-clamp-2 text-sm text-muted-foreground">{game.instructions}</p>}
      <div className="mt-auto flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => setEditing({ key: game.id, game, format: game.format })}><Pencil className="size-4" />Editar</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setPreview(game)}><Eye className="size-4" />Prévia</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void duplicate(game)}><Copy className="size-4" />Duplicar</Button>
        <Button size="sm" variant="ghost" className="text-rose-400 light:text-rose-700 hover:text-rose-300 light:hover:text-rose-800 hover:bg-rose-500/10"
          disabled={busy} onClick={() => void remove(game)}><Trash2 className="size-4" />Excluir</Button>
      </div>
    </article>)}</div></section>)}</div>}
    <p className="text-sm text-muted-foreground">Depois de publicar, selecione o jogo ao adicionar uma etapa à trilha. Na etapa, defina a repetição, a obrigatoriedade e o peso da nota. O mesmo jogo pode ser reutilizado em várias etapas do seu eixo.</p>
  </div>
}
