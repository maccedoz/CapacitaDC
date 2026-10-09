"use client"

import { CorrectionsQueue } from "@/components/dashboard/corrections-queue"
import { useDashboard } from "@/components/dashboard/dashboard-context"

export function CorrectionsTab() {
  const { axis, isOrg, activities, users } = useDashboard()
  return (
    <>
      <div className="space-y-1">
        <h2 className="text-2xl font-bold text-foreground">Correções</h2>
        <p className="text-muted-foreground text-sm">
          Todos os envios em uma fila, pendentes primeiro. Nas atividades obrigatórias, a melhor nota entra na média ponderada assim que você salva.
        </p>
      </div>
      <CorrectionsQueue activities={activities.activities} isOrganizer={isOrg} managerAxis={axis} onGraded={() => { void users.refresh() }} />
    </>
  )
}
