"use client"

import { useEffect, useRef, useState } from "react"
import { Eye, Save, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { gamesApi } from "@/features/games/api"
import { gameFormatLabels, newGame } from "@/features/games/drafts"
import { publicationIssues } from "@/features/games/validation"
import type { Game, GameDraft, GameFormat } from "@/features/games/types"
import { EditorField, editorSelectClass } from "./editor-fields"
import { QuizEditor } from "./quiz-editor"
import { OpenResponseEditor } from "./open-response-editor"
import { ScenarioEditor } from "./scenario-editor"
import { MatchingEditor } from "./matching-editor"
import { OrderingEditor } from "./ordering-editor"
import { CategorizationEditor } from "./categorization-editor"
import { GamePreviewScreen } from "./game-preview-screen"

export interface GameAxis { value: string; label: string }

function gameDraft(game: Game): GameDraft {
  const { title, instructions, eixo, format, config } = game
  return { title, instructions, eixo, format, config } as GameDraft
}

export function GameEditor({ game, format, axes, onChanged, onClose }: { game: Game | null; format: GameFormat; axes: GameAxis[]; onChanged: (game: Game) => void; onClose: () => void }) {
  const [savedGame, setSavedGame] = useState(game)
  const [draft, setDraft] = useState<GameDraft>(() => game ? gameDraft(game) : newGame(format, axes[0]?.value || "comercial"))
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(game ? gameDraft(game) : newGame(format, axes[0]?.value || "comercial")))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [issues, setIssues] = useState<string[]>([])
  const [preview, setPreview] = useState(false)
  const actionPending = useRef(false)
  const dirty = JSON.stringify(draft) !== savedSnapshot

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = "" } }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [dirty])

  const changeDraft = (next: GameDraft) => { setDraft(next); setMessage(""); setIssues([]) }
  const persist = async (publish: boolean) => {
    if (actionPending.current) return
    if (!draft.title.trim()) { setIssues(["Informe o título para salvar o rascunho."]); return }
    if (publish) {
      const found = publicationIssues(draft)
      setIssues(found)
      if (found.length) return
    }
    actionPending.current = true
    setBusy(true)
    setError("")
    setMessage("")
    try {
      let updated = savedGame && !dirty ? savedGame : savedGame ? await gamesApi.update(savedGame.id, draft) : await gamesApi.create(draft)
      setSavedGame(updated)
      setDraft(gameDraft(updated))
      setSavedSnapshot(JSON.stringify(gameDraft(updated)))
      onChanged(updated)
      if (publish) {
        updated = await gamesApi.publish(updated.id)
        setSavedGame(updated)
        setDraft(gameDraft(updated))
        setSavedSnapshot(JSON.stringify(gameDraft(updated)))
        onChanged(updated)
      }
      setMessage(publish ? `Versão ${updated.published_revision?.version} publicada. Já pode ser adicionada à trilha.` : "Rascunho salvo.")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o jogo. Seu rascunho foi mantido neste formulário.")
    } finally {
      actionPending.current = false
      setBusy(false)
    }
  }
  const close = () => { if (!dirty || window.confirm("Há alterações não salvas. Descartar estas alterações e fechar o editor?")) onClose() }

  if (preview) return <GamePreviewScreen draft={draft} onClose={() => setPreview(false)} backLabel="Voltar ao editor" />

  return <section className="rounded-xl border bg-card p-4 sm:p-6" aria-label="Editor de jogo">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-xl font-semibold">{savedGame ? "Editar jogo" : "Novo jogo"}</h2><p className="mt-1 text-sm text-muted-foreground">{gameFormatLabels[draft.format]}</p></div>
      <Badge variant="outline">{dirty ? "Alterações não salvas" : savedGame?.published_revision ? `Versão ${savedGame.published_revision.version}${savedGame.has_unpublished_changes ? " · novo rascunho" : " publicada"}` : "Rascunho"}</Badge>
    </div>
    <fieldset disabled={busy} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <EditorField label="Título do jogo"><Input maxLength={200} value={draft.title} onChange={event => changeDraft({ ...draft, title: event.target.value })} /></EditorField>
        <EditorField label="Eixo"><select className={editorSelectClass} disabled={!!savedGame?.published_revision} value={draft.eixo} onChange={event => changeDraft({ ...draft, eixo: event.target.value })}>{axes.map(axis => <option key={axis.value} value={axis.value}>{axis.label}</option>)}</select></EditorField>
      </div>
      {savedGame?.published_revision && <p className="text-xs text-muted-foreground">O eixo permanece fixo após a publicação. Duplique o jogo para usar em outro eixo.</p>}
      <EditorField label="Instruções (opcional)"><Textarea value={draft.instructions} onChange={event => changeDraft({ ...draft, instructions: event.target.value })} /></EditorField>
      {draft.format === "quiz" && <QuizEditor config={draft.config} onChange={config => changeDraft({ ...draft, config })} />}
      {draft.format === "open_response" && <OpenResponseEditor config={draft.config} onChange={config => changeDraft({ ...draft, config })} />}
      {draft.format === "scenario" && <ScenarioEditor config={draft.config} onChange={config => changeDraft({ ...draft, config })} />}
      {draft.format === "matching" && <MatchingEditor config={draft.config} onChange={config => changeDraft({ ...draft, config })} />}
      {draft.format === "ordering" && <OrderingEditor config={draft.config} onChange={config => changeDraft({ ...draft, config })} />}
      {draft.format === "categorization" && <CategorizationEditor config={draft.config} onChange={config => changeDraft({ ...draft, config })} />}
    </fieldset>
    <div className="mt-6 space-y-4 border-t pt-5">
      <p className="text-xs text-muted-foreground">Salve mesmo que o conteúdo esteja incompleto. Publicar cria uma versão fixa; etapas já vinculadas continuam usando a versão escolhida anteriormente.</p>
      {error && <p role="alert" className="rounded-md bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {!!issues.length && <div role="alert" className="rounded-md bg-destructive/5 p-3 text-sm text-destructive"><p className="font-semibold">Revise antes de publicar:</p><ul className="mt-2 list-disc space-y-1 pl-5">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
      {message && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || (!!savedGame && !dirty)} onClick={() => void persist(false)}><Save className="size-4" />{busy ? "Salvando…" : "Salvar rascunho"}</Button>
        <Button variant="outline" disabled={busy} onClick={() => setPreview(true)}><Eye className="size-4" />Pré-visualizar</Button>
        <Button variant="outline" disabled={busy || (!!savedGame?.published_revision && !savedGame.has_unpublished_changes && !dirty)} onClick={() => void persist(true)}><Upload className="size-4" />Publicar versão</Button>
        <Button variant="ghost" disabled={busy} onClick={close}>Fechar editor</Button>
      </div>
    </div>
  </section>
}
