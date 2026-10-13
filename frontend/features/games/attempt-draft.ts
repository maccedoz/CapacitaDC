import type { AttemptPayload, BoardCard, GameAttempt } from "./types"

/** In-progress answers of any format, kept in the browser so a reload loses nothing. */
export interface AttemptDraft {
  answers: Record<string, string[]>
  openAnswers: Record<string, string>
  selection: Record<string, string>
  order: string[]
}

const storageKey = (attemptId: string) => `game-answers:${attemptId}`

export function emptyDraft(): AttemptDraft {
  return { answers: {}, openAnswers: {}, selection: {}, order: [] }
}

function stringRecord(value: unknown, arrays: boolean): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, entry]) =>
    arrays ? Array.isArray(entry) && entry.every(item => typeof item === "string") : typeof entry === "string"))
}

export function boardItems(attempt: GameAttempt): BoardCard[] {
  return (attempt.format === "ordering" ? attempt.board?.items : undefined) || []
}

export function restoreDraft(attempt: GameAttempt): AttemptDraft {
  const fallback = { ...emptyDraft(), order: boardItems(attempt).map(item => item.id) }
  let stored: unknown = null
  try {
    const raw = sessionStorage.getItem(storageKey(attempt.id))
    stored = raw ? JSON.parse(raw) : null
  } catch { /* Answers stay editable when browser storage is unavailable. */ }
  if (!stored || typeof stored !== "object") return fallback
  const saved = stored as Partial<AttemptDraft>
  const order = Array.isArray(saved.order) && saved.order.every(id => typeof id === "string") ? saved.order : []
  const arrangementIsValid = order.length === fallback.order.length && new Set(order).size === order.length && order.every(id => fallback.order.includes(id))
  return {
    answers: stringRecord(saved.answers, true) as Record<string, string[]>,
    openAnswers: stringRecord(saved.openAnswers, false) as Record<string, string>,
    selection: stringRecord(saved.selection, false) as Record<string, string>,
    order: arrangementIsValid ? order : fallback.order,
  }
}

export function saveDraft(attemptId: string, draft: AttemptDraft): void {
  try { sessionStorage.setItem(storageKey(attemptId), JSON.stringify(draft)) } catch { /* Browser storage is optional. */ }
}

export function discardDraft(attemptId: string): void {
  try { sessionStorage.removeItem(storageKey(attemptId)) } catch { /* Browser storage is optional. */ }
}

export function attemptPayload(attempt: GameAttempt, draft: AttemptDraft): AttemptPayload {
  switch (attempt.format) {
    case "quiz":
      return { answers: (attempt.questions || []).map(question => ({ question_id: question.id, option_ids: draft.answers[question.id] || [] })) }
    case "open_response":
      return { open_answers: (attempt.open_questions || []).map(question => ({ question_id: question.id, text: draft.openAnswers[question.id] || "" })) }
    case "matching":
      return { matches: (attempt.board?.left || []).map(card => ({ left_id: card.id, right_id: draft.selection[card.id] || "" })) }
    case "ordering":
      return { order: draft.order }
    case "categorization":
      return { placements: (attempt.board?.items || []).map(item => ({ item_id: item.id, category_id: draft.selection[item.id] || "" })) }
    default:
      return {}
  }
}

export function isComplete(attempt: GameAttempt, draft: AttemptDraft): boolean {
  switch (attempt.format) {
    case "quiz":
      return !!attempt.questions?.length && attempt.questions.every(question => draft.answers[question.id]?.length)
    case "open_response":
      return !!attempt.open_questions?.length && attempt.open_questions.every(question => {
        const answer = draft.openAnswers[question.id] || ""
        return answer.trim().length > 0 && answer.length <= 5000
      })
    case "matching":
      return !!attempt.board?.left?.length && attempt.board.left.every(card => draft.selection[card.id])
    case "ordering":
      return draft.order.length === boardItems(attempt).length && draft.order.length > 0
    case "categorization":
      return !!attempt.board?.items?.length && attempt.board.items.every(item => draft.selection[item.id])
    default:
      return attempt.can_finish
  }
}
