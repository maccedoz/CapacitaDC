"use client"

// features/gamification/hooks.ts — Member points, level, achievements and ranking

import { useCallback, useEffect, useRef, useState } from "react"
import { gamificationApi } from "./api"
import type { GamificationSummary } from "./types"

export function useGamification(enabled: boolean, userId?: string) {
  const [summary, setSummary] = useState<GamificationSummary | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const version = useRef(0)

  const refresh = useCallback(async () => {
    if (!enabled) return
    const request = ++version.current
    setLoading(true)
    try {
      const result = await gamificationApi.summary()
      if (request !== version.current) return
      // An unexpected body must not break the member page that shows the badge.
      if (!result || typeof result.points !== "number" || !result.level) throw new Error("Resposta inválida ao carregar sua pontuação.")
      setSummary(result)
      setError(null)
    } catch (cause) {
      if (request === version.current) setError(cause instanceof Error ? cause.message : "Não foi possível carregar sua pontuação.")
    } finally {
      if (request === version.current) setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    setSummary(null)
    setError(null)
    if (!enabled) setLoading(false)
    void refresh()
    return () => { version.current++ }
  }, [enabled, refresh, userId])

  useEffect(() => {
    if (!enabled) return
    const onVisible = () => { if (document.visibilityState === "visible") void refresh() }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [enabled, refresh])

  const acknowledge = async (achievementIds: string[]) => {
    const request = ++version.current
    const result = await gamificationApi.acknowledge(achievementIds)
    if (request === version.current) setSummary(result)
  }

  return { summary, loading, error, refresh, acknowledge }
}
