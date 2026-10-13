"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Award, BarChart3, ClipboardCheck, ClipboardList, Compass, FileQuestion, History, Lightbulb, Shield, Users,
} from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { homePath, isStaff, managerAxis, memberAxisLabels } from "@/lib/roles"
import { AppHeader } from "@/components/app-header"
import type { ContentItem } from "@/components/dashboard/content-card"
import {
  DASHBOARD_TABS, DashboardProvider, type DashboardData, type DashboardTab,
} from "@/components/dashboard/dashboard-context"
import { ActivitiesTab } from "@/components/dashboard/tabs/activities-tab"
import { CorrectionsTab } from "@/components/dashboard/tabs/corrections-tab"
import { GradesTab } from "@/components/dashboard/tabs/grades-tab"
import { HistoryTab } from "@/components/dashboard/tabs/history-tab"
import { DashboardsTab } from "@/components/dashboard/tabs/dashboards-tab"
import { SuggestionsTab } from "@/components/dashboard/tabs/suggestions-tab"
import { MaterialsTab } from "@/components/dashboard/tabs/materials-tab"
import { TrailTab } from "@/components/dashboard/tabs/trail-tab"
import { UsersTab } from "@/components/dashboard/tabs/users-tab"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useActivities } from "@/features/activities/hooks"
import { useMaterials } from "@/features/materials/hooks"
import { useNodes } from "@/features/nodes/hooks"
import { useUsers } from "@/features/users/hooks"
import { useSuggestions } from "@/features/suggestions/hooks"

export default function Dashboard() {
  const { user, isLoading } = useAuth()
  if (isLoading) return <DashboardLoading />
  // Trocar de conta, papel ou eixo recria o painel: nada do escopo anterior fica na tela.
  // A aba fica na URL (?aba=...), lida com useSearchParams, que exige Suspense.
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardContent key={`${user?.id ?? ""}:${user?.type ?? ""}:${user?.eixo ?? ""}`} />
    </Suspense>
  )
}

function DashboardLoading() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Carregando...</div>
    </div>
  )
}

const TAB_TRIGGER = "gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"

function isDashboardTab(value: string | null): value is DashboardTab {
  return !!value && (DASHBOARD_TABS as string[]).includes(value)
}

function DashboardContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, isLoading } = useAuth()
  // Gerente: o painel fica preso ao eixo dele e ao PlugInfo (o servidor aplica a mesma regra).
  const axis = managerAxis(user)

  const materials = useMaterials()
  const users = useUsers()
  const nodes = useNodes()
  const activities = useActivities()
  const readsSuggestions = user?.type === "admin" || user?.type === "organizador"
  const suggestions = useSuggestions("all", readsSuggestions)

  const requestedTab = searchParams.get("aba")
  const activeTab: DashboardTab = isDashboardTab(requestedTab) && (requestedTab !== "sugestoes" || readsSuggestions)
    ? requestedTab : "usuarios"
  const [activitySubTab, setActivitySubTab] = useState("entregas")

  const setActiveTab = (tab: string) => {
    if (!isDashboardTab(tab)) return
    const params = new URLSearchParams(searchParams.toString())
    params.set("aba", tab)
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    if (!isLoading) {
      if (!user) router.push("/login")
      else if (!isStaff(user.type)) router.push(homePath(user.type))
    }
  }, [user, isLoading, router])

  if (isLoading || !user || !isStaff(user.type)) return <DashboardLoading />

  const isManager = axis !== null
  const isOrg = user.type === "organizador"
  const axisName = axis ? memberAxisLabels[axis] : ""

  const data: DashboardData = {
    user, axis, isManager, isOrg, axisName,
    defaultEixo: axis ?? "trainee",
    materials,
    contents: materials.materials as unknown as ContentItem[],
    users, nodes, activities,
    suggestions: readsSuggestions ? suggestions : null,
    activitySubTab, setActivitySubTab,
    navigate: (tab, subTab) => {
      if (subTab) setActivitySubTab(subTab)
      setActiveTab(tab)
    },
  }

  return (
    <DashboardProvider value={data}>
      <main className="min-h-screen bg-background">
        <AppHeader
          icon={Shield}
          title={isManager ? `Gerente — ${axisName}` : isOrg ? "Dashboard Organizador" : "Dashboard Admin"}
          subtitle={isManager ? "Seu eixo e o PlugInfo" : isOrg ? "Gestão do PlugInfo" : "Gestão Comercial"}
          badges={
            <Badge variant="outline" className="text-primary border-primary/30">
              {isManager ? `Gerente · ${axisName}` : isOrg ? "PlugInfo" : "Admin"}
            </Badge>
          }
        />

        <div className="container mx-auto px-4 py-8">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
            <TabsList className="bg-card border border-border flex-wrap h-auto gap-1">
              <TabsTrigger value="usuarios" className={TAB_TRIGGER}>
                <Users className="h-4 w-4" />
                {isOrg ? "Trainees" : "Usuários"}
              </TabsTrigger>
              <TabsTrigger value="materiais" className={TAB_TRIGGER}>
                <FileQuestion className="h-4 w-4" />
                Materiais
              </TabsTrigger>
              <TabsTrigger value="atividades" className={TAB_TRIGGER}>
                <ClipboardList className="h-4 w-4" />
                Atividades
              </TabsTrigger>
              <TabsTrigger value="correcoes" className={TAB_TRIGGER}>
                <ClipboardCheck className="h-4 w-4" />
                Correções
              </TabsTrigger>
              <TabsTrigger value="notas" className={TAB_TRIGGER}>
                <Award className="h-4 w-4" />
                Notas
              </TabsTrigger>
              <TabsTrigger value="trilha" className={TAB_TRIGGER}>
                <Compass className="h-4 w-4" />
                Trilha
              </TabsTrigger>
              {readsSuggestions && (
                <TabsTrigger value="sugestoes" className={TAB_TRIGGER}>
                  <Lightbulb className="h-4 w-4" />
                  Sugestões
                  {suggestions.unread > 0 && (
                    <Badge className="ml-1 bg-amber-500 text-white text-[9px] px-1.5 py-0 h-4" aria-label={`${suggestions.unread} não lidas`}>
                      {suggestions.unread}
                    </Badge>
                  )}
                </TabsTrigger>
              )}
              <TabsTrigger value="historico" className={TAB_TRIGGER}>
                <History className="h-4 w-4" />Histórico
              </TabsTrigger>
              <TabsTrigger value="dashboards" className={TAB_TRIGGER}>
                <BarChart3 className="h-4 w-4" />Dashboards
              </TabsTrigger>
            </TabsList>

            <TabsContent value="usuarios" className="space-y-6"><UsersTab /></TabsContent>
            <TabsContent value="atividades" className="space-y-6"><ActivitiesTab /></TabsContent>
            <TabsContent value="correcoes" className="space-y-6"><CorrectionsTab /></TabsContent>
            <TabsContent value="notas" className="space-y-8"><GradesTab /></TabsContent>
            <TabsContent value="materiais" className="space-y-6"><MaterialsTab /></TabsContent>
            <TabsContent value="trilha" className="space-y-6"><TrailTab /></TabsContent>
            <TabsContent value="historico" className="space-y-6"><HistoryTab /></TabsContent>
            <TabsContent value="dashboards" className="space-y-6"><DashboardsTab /></TabsContent>
            {readsSuggestions && <TabsContent value="sugestoes" className="space-y-6"><SuggestionsTab /></TabsContent>}
          </Tabs>
        </div>
      </main>
    </DashboardProvider>
  )
}
