"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { emptyDraft, isComplete, type AttemptDraft } from "@/features/games/attempt-draft"
import { previewBoard, previewResult, scenarioPreviewResult } from "@/features/games/preview"
import { publicationIssues } from "@/features/games/validation"
import type { GameAttempt, GameDraft, GameResult } from "@/features/games/types"
import { CategorizationBoard, MatchingBoard, OrderingBoard } from "./game-boards"
import { GameResultView, OpenResponseChoices, QuizChoices, ScenarioChoices } from "./game-play-content"

export function GamePreview({ draft }: { draft: GameDraft }) {
  const [round, setRound] = useState(0)
  const [state, setState] = useState<AttemptDraft>(emptyDraft)
  const [stepId, setStepId] = useState(draft.format === "scenario" ? draft.config.start_step_id : "")
  const [path, setPath] = useState<{ stepId: string; optionId: string }[]>([])
  const [result, setResult] = useState<GameResult | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const issues = publicationIssues(draft)
  // The board is shuffled once per preview round, like a real attempt.
  const board = useMemo(() => previewBoard(draft), [draft, round])
  const arrangement = useMemo(() => {
    const cards = new Map((board?.items || []).map(item => [item.id, item]))
    const chosen = state.order.map(id => cards.get(id)).filter((item): item is NonNullable<typeof item> => !!item)
    return chosen.length === cards.size ? chosen : board?.items || []
  }, [board, state.order])

  const restart = () => {
    setRound(value => value + 1)
    setState(emptyDraft())
    setResult(null)
    setSubmitted(false)
    setPath([])
    setStepId(draft.format === "scenario" ? draft.config.start_step_id : "")
  }
  const selectDecision = (optionId: string) => {
    if (draft.format !== "scenario") return
    const step = draft.config.steps.find(item => item.id === stepId)
    const option = step?.options.find(item => item.id === optionId)
    if (!step || !option) return
    const next = [...path, { stepId: step.id, optionId }]
    setPath(next)
    if (option.next_step_id) setStepId(option.next_step_id)
    else setResult(scenarioPreviewResult(draft.config, next))
  }
  // A finished preview needs the same answers a real attempt would send.
  const asAttempt = { format: draft.format, questions: draft.format === "quiz" ? draft.config.questions.map(question => ({ id: question.id, text: question.text, selection: question.selection, options: question.options })) : [], open_questions: draft.format === "open_response" ? draft.config.questions : [], board, can_finish: true } as unknown as GameAttempt
  const ready = isComplete(asAttempt, { ...state, order: arrangement.map(item => item.id) })
  const currentStep = draft.format === "scenario" ? draft.config.steps.find(step => step.id === stepId) : null

  return <div className="space-y-5">
    <p className="rounded-md bg-muted p-3 text-sm">Pré-visualização administrativa. As respostas desta prévia não alteram o progresso.</p>
    {issues.length ? <div className="space-y-2 text-sm"><p className="font-semibold">Complete o rascunho para testar:</p><ul className="list-disc space-y-1 pl-5">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div> : <>
      <h3 className="text-xl font-semibold">{draft.title}</h3>
      {draft.instructions && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{draft.instructions}</p>}
      {submitted ? <><p role="status" className="rounded-lg border p-4">Respostas enviadas. O participante verá “Aguardando correção” até a gestão publicar a nota e o feedback.</p><Button variant="outline" onClick={restart}>Reiniciar prévia</Button></> : result ? <><GameResultView result={result} preview /><Button variant="outline" onClick={restart}>Reiniciar prévia</Button></> : <>
        {draft.format === "open_response" && <OpenResponseChoices questions={draft.config.questions} answers={state.openAnswers} onChange={(questionId, text) => setState(previous => ({ ...previous, openAnswers: { ...previous.openAnswers, [questionId]: text } }))} />}
        {draft.format === "quiz" && <QuizChoices questions={asAttempt.questions || []} answers={state.answers} onChange={(questionId, optionIds) => setState(previous => ({ ...previous, answers: { ...previous.answers, [questionId]: optionIds } }))} />}
        {draft.format === "matching" && board && <MatchingBoard board={board} value={state.selection} onChange={(leftId, rightId) => setState(previous => ({ ...previous, selection: { ...previous.selection, [leftId]: rightId } }))} />}
        {draft.format === "ordering" && <OrderingBoard items={arrangement} onChange={items => setState(previous => ({ ...previous, order: items.map(item => item.id) }))} />}
        {draft.format === "categorization" && board && <CategorizationBoard board={board} value={state.selection} onChange={(itemId, categoryId) => setState(previous => ({ ...previous, selection: { ...previous.selection, [itemId]: categoryId } }))} />}
        {draft.format === "scenario" ? currentStep && <ScenarioChoices step={currentStep} onSelect={selectDecision} /> : <Button disabled={!ready} onClick={() => draft.format === "open_response" ? setSubmitted(true) : setResult(previewResult(draft, { ...state, order: arrangement.map(item => item.id) }))}>{draft.format === "open_response" ? "Enviar respostas da prévia" : "Concluir prévia"}</Button>}
      </>}
    </>}
  </div>
}
