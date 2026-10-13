"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { gamesApi } from "@/features/games/api"
import { attemptPayload, boardItems, discardDraft, emptyDraft, isComplete, restoreDraft, saveDraft, type AttemptDraft } from "@/features/games/attempt-draft"
import type { GameAttempt, GameResult, OpenAnswer } from "@/features/games/types"
import { asUtcDate } from "@/lib/datetime"
import { CategorizationBoard, MatchingBoard, OrderingBoard } from "./game-boards"
import { GameResultView, OpenResponseChoices, QuizChoices, ScenarioChoices } from "./game-play-content"

interface LibraryGameProps {
  nodeId: string
  allowRetry?: boolean
  onCompleted: (result: GameResult) => Promise<void>
  onClose: () => void
}

const finishLabels: Record<string, string> = {
  quiz: "Concluir questionário", scenario: "Concluir cenário", matching: "Concluir associação",
  open_response: "Enviar respostas para correção",
  ordering: "Concluir ordenação", categorization: "Concluir classificação",
}

export function LibraryGame({ nodeId, allowRetry = true, onCompleted, onClose }: LibraryGameProps) {
  const [attempt, setAttempt] = useState<GameAttempt | null>(null)
  const [draft, setDraft] = useState<AttemptDraft>(emptyDraft)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  const opening = useRef<{ nodeId: string; retry: number; promise: Promise<GameAttempt> } | null>(null)
  const actionPending = useRef(false)
  const newAttempt = useRef(false)
  const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : "Não foi possível salvar sua resposta. Tente novamente."

  useEffect(() => {
    let active = true
    setBusy(true)
    setError("")
    setAttempt(null)
    if (!opening.current || opening.current.nodeId !== nodeId || opening.current.retry !== retry) {
      opening.current = { nodeId, retry, promise: gamesApi.begin(nodeId, newAttempt.current) }
    }
    opening.current.promise.then(next => {
      if (!active) return
      setAttempt(next)
      setDraft(restoreDraft(next))
    }).catch(cause => { if (active) setError(errorMessage(cause)) }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [nodeId, retry])

  const changeDraft = (patch: Partial<AttemptDraft>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    if (attempt) saveDraft(attempt.id, next)
  }

  const perform = useCallback(async (action: () => Promise<void>) => {
    if (actionPending.current) return
    actionPending.current = true
    setBusy(true)
    setError("")
    try { await action() } catch (cause) { setError(errorMessage(cause)) } finally { actionPending.current = false; setBusy(false) }
  }, [])

  const arrangement = useMemo(() => {
    if (!attempt) return []
    const cards = new Map(boardItems(attempt).map(item => [item.id, item]))
    return draft.order.map(id => cards.get(id)).filter((item): item is NonNullable<typeof item> => !!item)
  }, [attempt, draft.order])

  const finish = () => {
    if (!attempt) return
    void perform(async () => {
      const result = await gamesApi.complete(attempt.id, attemptPayload(attempt, draft))
      setAttempt(result)
      discardDraft(attempt.id)
    })
  }

  const ready = !!attempt && isComplete(attempt, draft)
  const submittedAnswers = Object.fromEntries((attempt?.answers || []).filter((answer): answer is OpenAnswer => typeof answer === "object" && "text" in answer && "question_id" in answer).map(answer => [answer.question_id, answer.text]))
  return <Card className="w-full">
    <CardHeader><CardTitle>{attempt?.title || "Carregando jogo"}</CardTitle>{attempt?.instructions && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{attempt.instructions}</p>}</CardHeader>
    <CardContent className="space-y-5">
      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {!attempt && busy && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />Abrindo sua tentativa…</p>}
      {!attempt && !busy && <Button onClick={() => setRetry(value => value + 1)}>Tentar novamente</Button>}
      {attempt?.result ? <>
        <GameResultView result={attempt.result} />
        {attempt.graded_at && <p className="text-xs text-muted-foreground">Corrigido por {attempt.graded_by_name || "gestão"} em {asUtcDate(attempt.graded_at).toLocaleString("pt-BR")}.</p>}
        {allowRetry ? <Button variant={attempt.result.step_completed === false ? "default" : "outline"} disabled={busy} onClick={() => { newAttempt.current = true; setRetry(value => value + 1) }}>{attempt.result.step_completed === false ? "Tentar novamente" : "Repetir jogo"}</Button> : <p className="text-sm text-muted-foreground">A repetição deste jogo não está permitida.</p>}
        <Button disabled={busy} variant={attempt.result.step_completed === false ? "outline" : "default"} className="w-full" onClick={() => void perform(() => onCompleted(attempt.result!))}>{busy ? "Atualizando trilha…" : "Voltar à trilha"}</Button>
      </> : attempt?.status === "pending_review" ? <>
        <div role="status" className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <h3 className="font-semibold">Aguardando correção</h3>
          <p className="text-sm">Suas respostas foram enviadas. A nota e o feedback aparecerão após a avaliação da gestão. Esta tentativa fica disponível para consulta.</p>
        </div>
        <OpenResponseChoices questions={attempt.open_questions || []} answers={submittedAnswers} readOnly />
        <Button variant="outline" disabled={busy} onClick={() => void perform(async () => setAttempt(await gamesApi.getAttempt(attempt.id)))}>{busy ? "Consultando correção…" : "Atualizar correção"}</Button>
      </> : attempt && <>
        <p className="text-sm text-muted-foreground">{attempt.format === "open_response" ? "Responda todas as perguntas. A gestão avaliará seu envio com nota e feedback." : "O feedback das suas respostas será exibido ao concluir."}</p>
        {attempt.format === "open_response" && <OpenResponseChoices questions={attempt.open_questions || []} answers={draft.openAnswers} disabled={busy} onChange={(questionId, text) => changeDraft({ openAnswers: { ...draft.openAnswers, [questionId]: text } })} />}
        {attempt.format === "quiz" && <QuizChoices questions={attempt.questions || []} answers={draft.answers} disabled={busy} onChange={(questionId, optionIds) => changeDraft({ answers: { ...draft.answers, [questionId]: optionIds } })} />}
        {attempt.format === "matching" && attempt.board && <MatchingBoard board={attempt.board} value={draft.selection} disabled={busy} onChange={(leftId, rightId) => changeDraft({ selection: { ...draft.selection, [leftId]: rightId } })} />}
        {attempt.format === "ordering" && <OrderingBoard items={arrangement} disabled={busy} onChange={items => changeDraft({ order: items.map(item => item.id) })} />}
        {attempt.format === "categorization" && attempt.board && <CategorizationBoard board={attempt.board} value={draft.selection} disabled={busy} onChange={(itemId, categoryId) => changeDraft({ selection: { ...draft.selection, [itemId]: categoryId } })} />}
        {attempt.format === "scenario" ? <>
          <p className="text-xs text-muted-foreground">Decisões registradas: {attempt.answers.length}</p>
          {attempt.current_step && <ScenarioChoices step={attempt.current_step} disabled={busy} onSelect={optionId => void perform(async () => setAttempt(await gamesApi.answer(attempt.id, attempt.current_step!.id, optionId)))} />}
          {attempt.can_finish && <><p className="text-sm">Você chegou ao fim deste caminho.</p><Button disabled={busy} onClick={finish}>{busy ? "Calculando resultado…" : finishLabels.scenario}</Button></>}
          {busy && <p role="status" className="text-sm text-muted-foreground">Salvando sua decisão…</p>}
        </> : <Button disabled={busy || !ready} onClick={finish}>{busy ? "Salvando respostas…" : finishLabels[attempt.format]}</Button>}
      </>}
      {!attempt?.result && <Button variant="outline" disabled={busy} onClick={onClose}>Voltar à trilha</Button>}
    </CardContent>
  </Card>
}
