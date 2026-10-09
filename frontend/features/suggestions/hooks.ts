// features/suggestions/hooks.ts

import { useCallback, useEffect, useState } from "react"
import { suggestionsApi, type Suggestion } from "./api"

/** Lista de sugestões: as do próprio trainee ("mine") ou todas, para quem lê. */
export function useSuggestions(scope: "mine" | "all", enabled = true) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError(null)
    try {
      setSuggestions(await (scope === "mine" ? suggestionsApi.mine() : suggestionsApi.list()))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar as sugestões.")
    } finally {
      setLoading(false)
    }
  }, [scope, enabled])

  useEffect(() => { void refresh() }, [refresh])

  const send = async (text: string) => {
    const created = await suggestionsApi.create(text)
    setSuggestions(previous => [created, ...previous])
  }

  const mark = async (id: string, read: boolean) => {
    const updated = await suggestionsApi.mark(id, read)
    setSuggestions(previous => previous.map(item => item.id === id ? updated : item))
  }

  const unread = suggestions.filter(item => !item.read_at).length

  return { suggestions, loading, error, refresh, send, mark, unread }
}
