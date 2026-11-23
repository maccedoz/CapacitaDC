"use client"

// features/nodes/hooks.ts — Custom hooks for training node state management

import { useState, useCallback, useEffect, useRef } from "react"
import { nodesApi } from "./api"
import { asUtcDate, localInputToUtc, utcToLocalInput } from "@/lib/datetime"
import type { TrainingNode, NodeContent, NodeReleasePayload, GameAnswer } from "./types"

type ReleaseDraft = { isReleased: boolean; scheduledDate: string }

function releaseDraft(node: TrainingNode): ReleaseDraft {
  return {
    isReleased: node.is_released,
    scheduledDate: node.released_at ? utcToLocalInput(node.released_at) : "",
  }
}

function sameRelease(a: ReleaseDraft | undefined, b: ReleaseDraft | undefined): boolean {
  return a?.isReleased === b?.isReleased && a?.scheduledDate === b?.scheduledDate
}

export function useNodes() {
  const [nodes, setNodes] = useState<TrainingNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Per-node local release state: nodeId → { isReleased, scheduledDate }
  const [nodeReleaseState, setNodeReleaseState] = useState<Record<string, ReleaseDraft>>({})
  const savedReleases = useRef<Record<string, ReleaseDraft>>({})
  const listVersion = useRef(0)
  const lastReadStartedAt = useRef(0)
  const saving = useRef(new Set<string>())
  const [savingNodeIds, setSavingNodeIds] = useState(new Set<string>())

  const refresh = useCallback(async () => {
    // A list fetched during a write may still contain the pre-save value.
    if (saving.current.size > 0) return
    const request = ++listVersion.current
    const startedAt = Date.now()
    try {
      setLoading(true)
      const data = await nodesApi.list()
      if (request !== listVersion.current) return
      lastReadStartedAt.current = startedAt
      setNodes(data)
      setError(null)
      const previousSaved = savedReleases.current
      const nextSaved = Object.fromEntries(data.map(node => [node.id, releaseDraft(node)]))
      savedReleases.current = nextSaved
      setNodeReleaseState(previous => {
        const next: Record<string, ReleaseDraft> = {}
        for (const node of data) {
          // Polling can update the server state without erasing an unsaved draft.
          next[node.id] = previous[node.id] && !sameRelease(previous[node.id], previousSaved[node.id])
            ? previous[node.id]
            : nextSaved[node.id]
        }
        return next
      })
    } catch (e: unknown) {
      if (request === listVersion.current) {
        setError(e instanceof Error ? e.message : "Erro ao carregar nós")
      }
    } finally {
      if (request === listVersion.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Liberações agendadas e prazos podem mudar o acesso sem uma ação da pessoa.
  useEffect(() => {
    if (nodes.length === 0) return

    const now = Date.now()
    const changesAt = nodes.flatMap(node => {
      if (!node.is_released) return []
      const dates = [node.released_at]
      if (node.type === "activity" && !node.completed) dates.push(node.deadline ?? null)
      // Refaça também consultas iniciadas antes de uma mudança e recebidas depois.
      return dates.filter((date): date is string => !!date)
        .map(date => asUtcDate(date).getTime())
        .filter(instant => instant > now || instant > lastReadStartedAt.current)
    })

    if (changesAt.length === 0) return

    // Schedule refresh at that exact moment (+ small buffer), capped at 60s interval
    const msUntilChange = Math.min(...changesAt) - Date.now()
    const delay = Math.min(Math.max(msUntilChange + 1000, 1000), 60_000)

    let cancelled = false
    const poll = async () => {
      await refresh()
      // Successful reads replace nodes and restart this effect. Retry failed or
      // skipped reads too, including a failure at the scheduled release time.
      if (!cancelled) timer = setTimeout(poll, 60_000)
    }
    let timer = setTimeout(poll, delay)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [nodes, refresh])

  const updateReleaseLocal = (
    nodeId: string,
    patch: Partial<ReleaseDraft>
  ) => {
    setNodeReleaseState((prev) => ({
      ...prev,
      [nodeId]: { ...prev[nodeId], ...patch },
    }))
  }

  const saveNodeRelease = async (nodeId: string) => {
    const state = nodeReleaseState[nodeId]
    if (!state || saving.current.has(nodeId)) return
    const payload: NodeReleasePayload = {
      is_released: state.isReleased,
      released_at:
        state.isReleased && state.scheduledDate
          ? localInputToUtc(state.scheduledDate)
          : null,
    }
    saving.current.add(nodeId)
    setSavingNodeIds(new Set(saving.current))
    ++listVersion.current // Discard reads started before this save.
    setLoading(false)
    try {
      const updated = await nodesApi.release(nodeId, payload)
      const saved = releaseDraft(updated)
      savedReleases.current = { ...savedReleases.current, [nodeId]: saved }
      setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, ...updated } : n)))
      setNodeReleaseState((prev) => sameRelease(prev[nodeId], state)
        ? { ...prev, [nodeId]: saved }
        : prev) // Keep edits made while the save was in flight.
    } finally {
      saving.current.delete(nodeId)
      setSavingNodeIds(new Set(saving.current))
      // Reconcile any reads skipped or invalidated while writes were pending,
      // including updates triggered by other actions on the trail.
      if (saving.current.size === 0) void refresh()
    }
  }

  const moveNode = async (nodeId: string, direction: "up" | "down", eixo: string) => {
    const eixoNodes = nodes
      .filter((n) => n.eixo === eixo)
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    const index = eixoNodes.findIndex((n) => n.id === nodeId)
    if (index === -1) return
    const targetIndex = direction === "up" ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= eixoNodes.length) return

    const currentNode = eixoNodes[index]
    const targetNode = eixoNodes[targetIndex]
    let newCurIdx = targetNode.order_index ?? 0
    let newTarIdx = currentNode.order_index ?? 0
    if (newCurIdx === newTarIdx) {
      newCurIdx = direction === "up" ? (currentNode.order_index ?? 0) - 1 : (currentNode.order_index ?? 0) + 1
      newTarIdx = currentNode.order_index ?? 0
    }

    await Promise.all([
      nodesApi.updateOrder(currentNode.id, { order_index: newCurIdx }),
      nodesApi.updateOrder(targetNode.id, { order_index: newTarIdx }),
    ])
    await refresh()
  }

  const deleteNode = async (nodeId: string) => {
    await nodesApi.delete(nodeId)
    setNodes((prev) => prev.filter((n) => n.id !== nodeId))
  }

  const completeNode = async (nodeId: string) => {
    const result = await nodesApi.complete(nodeId)
    await refresh()
    return result
  }

  const submitGame = async (nodeId: string, answers: GameAnswer[]) => {
    const result = await nodesApi.submitGame(nodeId, { answers })
    await refresh()
    return result
  }

  return {
    nodes,
    loading,
    error,
    refresh,
    nodeReleaseState,
    savingNodeIds,
    updateReleaseLocal,
    saveNodeRelease,
    moveNode,
    deleteNode,
    completeNode,
    submitGame,
  }
}

/** Load the selected step and its activity/material together, independently of the library. */
export function useNodeContent(nodeId: string | null) {
  const [content, setContent] = useState<NodeContent | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const version = useRef(0)

  const refresh = useCallback(async () => {
    const request = ++version.current
    setContent(null)
    setError(null)
    if (!nodeId) { setLoading(false); return }
    setLoading(true)
    try {
      const result = await nodesApi.content(nodeId)
      if (request === version.current) setContent(result)
    } catch (cause) {
      if (request === version.current) setError(cause instanceof Error ? cause.message : "Não foi possível carregar esta etapa.")
    } finally {
      if (request === version.current) setLoading(false)
    }
  }, [nodeId])

  useEffect(() => {
    void refresh()
    return () => { version.current++ }
  }, [refresh])

  // Do not display the previous step during the render before the effect runs.
  return { content: content?.node.id === nodeId ? content : null, loading, error, refresh }
}
