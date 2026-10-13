"use client"

// features/activities/hooks.ts — Custom hooks for activity state management

import { useState, useCallback, useEffect, useRef } from "react"
import { activitiesApi } from "./api"
import type {
  Activity,
  ActivityCreatePayload,
  ActivityUpdatePayload,
  ActivitySubmissionOut,
  SubmissionCreatePayload,
  SubmissionQueueFilters,
} from "./types"

export function useActivities() {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activitySubmissions, setActivitySubmissions] = useState<
    Record<string, ActivitySubmissionOut[]>
  >({})
  const [expandedActivity, setExpandedActivity] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      const data = await activitiesApi.list()
      setActivities(data)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar atividades")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createActivity = async (payload: ActivityCreatePayload) => {
    const created = await activitiesApi.create(payload)
    setActivities((prev) => [created, ...prev])
    return created
  }

  const updateActivity = async (
    activityId: string,
    payload: ActivityUpdatePayload
  ) => {
    const updated = await activitiesApi.update(activityId, payload)
    setActivities((prev) =>
      prev.map((a) => (a.id === activityId ? updated : a))
    )
    return updated
  }

  const deleteActivity = async (activityId: string) => {
    await activitiesApi.delete(activityId)
    setActivities((prev) => prev.filter((a) => a.id !== activityId))
  }

  const toggleActivity = async (activityId: string, currentOpen: boolean) => {
    return updateActivity(activityId, { is_open: !currentOpen })
  }

  const loadSubmissions = async (activityId: string) => {
    if (expandedActivity === activityId) {
      setExpandedActivity(null)
      return
    }
    const subs = await activitiesApi.getSubmissions(activityId)
    setActivitySubmissions((prev) => ({ ...prev, [activityId]: subs }))
    setExpandedActivity(activityId)
  }

  const submitActivity = async (activityId: string, payload: SubmissionCreatePayload) => {
    const result = await activitiesApi.submit(activityId, payload)
    await refresh()
    return result
  }

  const gradeSubmission = async (
    activityId: string,
    submissionId: string,
    grade: number,
    feedback: string
  ) => {
    const updated = await activitiesApi.gradeSubmission(activityId, submissionId, {
      grade,
      feedback,
    })
    setActivitySubmissions((prev) => ({
      ...prev,
      [activityId]: (prev[activityId] || []).map((s) =>
        s.id === submissionId ? updated : s
      ),
    }))
    return updated
  }

  const deleteSubmission = async (activityId: string, submissionId: string) => {
    await activitiesApi.deleteSubmission(activityId, submissionId)
    setActivitySubmissions((prev) => ({
      ...prev,
      [activityId]: (prev[activityId] || []).filter((s) => s.id !== submissionId),
    }))
    setActivities((prev) =>
      prev.map((a) =>
        a.id === activityId ? { ...a, submission_count: Math.max(0, a.submission_count - 1) } : a
      )
    )
  }

  return {
    activities,
    loading,
    error,
    refresh,
    activitySubmissions,
    expandedActivity,
    createActivity,
    updateActivity,
    deleteActivity,
    toggleActivity,
    loadSubmissions,
    submitActivity,
    gradeSubmission,
    deleteSubmission,
  }
}

/** Fila de correção: carrega sozinha, ao contrário da listagem por atividade. */
export function useSubmissionQueue() {
  const pageSize = 50
  const [items, setItems] = useState<ActivitySubmissionOut[]>([])
  const [filters, setFilterState] = useState<SubmissionQueueFilters>({ status: "pending", offset: 0 })
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const requestVersion = useRef(0)

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true)
    setError("")
    try {
      const rows = await activitiesApi.listQueue({ ...filters, limit: pageSize + 1 })
      if (version !== requestVersion.current) return
      setItems(rows.slice(0, pageSize))
      setHasMore(rows.length > pageSize)
    } catch (cause) {
      if (version === requestVersion.current) setError(cause instanceof Error ? cause.message : "Não foi possível carregar os envios.")
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [filters])

  useEffect(() => { void refresh(); return () => { requestVersion.current++ } }, [refresh])

  const setFilters = (next: SubmissionQueueFilters) => setFilterState({ ...next, offset: 0 })
  const setPage = (offset: number) => setFilterState(previous => ({ ...previous, offset: Math.max(0, offset) }))
  // Atualiza a lista sem recarregar: recarregar trocaria a fila por um carregamento e
  // apagaria o que está digitado nas outras entregas. No filtro de pendentes, a
  // entrega corrigida sai da lista; nos demais, é substituída pela versão nova.
  const applyGraded = (updated: ActivitySubmissionOut[]) => {
    const byId = new Map(updated.map(item => [item.id, item]))
    setItems(previous => filters.status === "pending"
      ? previous.filter(item => !byId.has(item.id))
      : previous.map(item => byId.get(item.id) ?? item))
  }

  const grade = async (activityId: string, submissionId: string, value: number, feedback: string) => {
    const updated = await activitiesApi.gradeSubmission(activityId, submissionId, { grade: value, feedback })
    applyGraded([updated])
    return updated
  }

  const gradeBatch = async (submissionIds: string[], value: number, feedback: string) => {
    const updated = await activitiesApi.gradeBatch(submissionIds, value, feedback)
    applyGraded(updated)
    return updated
  }

  const remove = async (activityId: string, submissionId: string) => {
    await activitiesApi.deleteSubmission(activityId, submissionId)
    setItems(previous => previous.filter(item => item.id !== submissionId))
  }

  return { items, filters, setFilters, setPage, pageSize, hasMore, loading, error, refresh, grade, gradeBatch, remove }
}
