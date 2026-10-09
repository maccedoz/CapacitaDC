"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { User } from "@/lib/auth-context"
import type { MemberAxis } from "@/lib/roles"
import type { ContentItem } from "@/components/dashboard/content-card"
import { useActivities } from "@/features/activities/hooks"
import { useMaterials } from "@/features/materials/hooks"
import { useNodes } from "@/features/nodes/hooks"
import { useUsers } from "@/features/users/hooks"
import { useSuggestions } from "@/features/suggestions/hooks"

export type DashboardTab = "usuarios" | "materiais" | "atividades" | "correcoes" | "notas" | "trilha" | "sugestoes"
export const DASHBOARD_TABS: DashboardTab[] = ["usuarios", "materiais", "atividades", "correcoes", "notas", "trilha", "sugestoes"]

/** Dados e escopo compartilhados pelas abas do painel da gestão. */
export interface DashboardData {
  user: User
  /** Eixo do gerente; null para os demais perfis. */
  axis: MemberAxis | null
  isManager: boolean
  isOrg: boolean
  axisName: string
  /** Eixo pré-selecionado nos formulários: o do gerente, ou o PlugInfo. */
  defaultEixo: string
  materials: ReturnType<typeof useMaterials>
  contents: ContentItem[]
  users: ReturnType<typeof useUsers>
  nodes: ReturnType<typeof useNodes>
  activities: ReturnType<typeof useActivities>
  /** Sugestões dos trainees; só para administradores e organizadores. */
  suggestions: ReturnType<typeof useSuggestions> | null
  activitySubTab: string
  setActivitySubTab: (tab: string) => void
  navigate: (tab: DashboardTab, activitySubTab?: string) => void
}

const DashboardContext = createContext<DashboardData | null>(null)

export function DashboardProvider({ value, children }: { value: DashboardData; children: ReactNode }) {
  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
}

export function useDashboard(): DashboardData {
  const context = useContext(DashboardContext)
  if (!context) throw new Error("useDashboard must be used within a DashboardProvider")
  return context
}
