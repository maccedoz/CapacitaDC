"use client"

import { CorrectionsQueue } from "@/components/dashboard/corrections-queue"
import { useDashboard } from "@/components/dashboard/dashboard-context"
import { OpenResponseQueue } from "@/components/dashboard/open-response-queue"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function CorrectionsTab() {
  const { axis, isOrg, activities, users, nodes } = useDashboard()
  const onGraded = () => { void users.refresh(); void nodes.refresh() }
  return (
    <>
      <div className="space-y-1">
        <h2 className="text-2xl font-bold text-foreground">Correções</h2>
        <p className="text-muted-foreground text-sm">
          Corrija entregas de atividades e respostas abertas. Nas avaliações obrigatórias, a melhor nota entra na média ponderada assim que você salva.
        </p>
      </div>
      <Tabs defaultValue="activities" className="space-y-5">
        <TabsList><TabsTrigger value="activities">Atividades</TabsTrigger><TabsTrigger value="open_response">Questionários abertos</TabsTrigger></TabsList>
        <TabsContent value="activities"><CorrectionsQueue activities={activities.activities} isOrganizer={isOrg} managerAxis={axis} onGraded={onGraded} /></TabsContent>
        <TabsContent value="open_response"><OpenResponseQueue isOrganizer={isOrg} managerAxis={axis} onGraded={onGraded} /></TabsContent>
      </Tabs>
    </>
  )
}
