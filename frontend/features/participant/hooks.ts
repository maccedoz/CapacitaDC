// features/participant/hooks.ts — O que os portais de membros e trainees têm em comum.

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { homePath, type UserRole } from "@/lib/roles"
import type { ContentItem } from "@/lib/content-data"
import { useNodes } from "@/features/nodes/hooks"
import type { TrainingNode } from "@/features/nodes/types"
import { useActivities } from "@/features/activities/hooks"
import { useMaterials } from "@/features/materials/hooks"

/**
 * Dados e ações do portal de um participante: redireciona quem não é do perfil
 * esperado, carrega trilha, atividades e biblioteca, e controla a etapa aberta no leitor.
 * `extraRefresh` entra na atualização feita depois de uma entrega ou conclusão.
 */
export function useParticipantPortal(role: Extract<UserRole, "membro" | "trainee">, extraRefresh?: () => Promise<unknown>) {
  const router = useRouter()
  const { user, isLoading, refreshUser } = useAuth()

  const { materials, refresh: refreshMaterials } = useMaterials()
  const contents: ContentItem[] = materials as unknown as ContentItem[]
  const { nodes, completeNode, refresh: refreshNodes } = useNodes()
  const { activities, refresh: refreshActivities } = useActivities()

  const [selectedNode, setSelectedNode] = useState<any | null>(null)
  const [isReading, setIsReading] = useState(false)

  useEffect(() => {
    if (!isLoading) {
      if (!user) router.push("/login")
      else if (user.type !== role) router.push(homePath(user.type))
    }
  }, [user, isLoading, router, role])

  const refreshProgress = async () => {
    // The submission is already saved; a refresh failure must not be reported as a failed submission.
    const refreshes: Promise<unknown>[] = [refreshUser(), refreshNodes(), refreshMaterials(), refreshActivities()]
    if (extraRefresh) refreshes.push(extraRefresh())
    const results = await Promise.allSettled(refreshes)
    results.forEach(result => {
      if (result.status === "rejected") console.error("Erro ao atualizar progresso:", result.reason)
    })
  }

  const closeReader = () => {
    setIsReading(false)
    setSelectedNode(null)
  }

  const selectNode = (node: Pick<TrainingNode, "id" | "type">) => {
    if (node.type === "game") {
      router.push(`/trilha/${encodeURIComponent(node.id)}/jogar`)
      return
    }
    setSelectedNode(node)
    setIsReading(true)
  }

  const completeMaterial = async () => {
    if (!selectedNode) return
    try {
      await completeNode(selectedNode.id)
      await refreshProgress()
      closeReader()
    } catch { alert("Erro ao salvar progresso") }
  }

  const ready = !isLoading && !!user && user.type === role

  return {
    user, ready, contents, nodes, activities, refreshActivities, refreshProgress,
    selectedNode, isReading, setIsReading, selectNode, completeMaterial, closeReader,
  }
}
