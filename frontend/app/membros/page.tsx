"use client"

import { useState } from "react"
import { useAuth } from "@/lib/auth-context"
import { axisLabel, normalizeAxis } from "@/lib/roles"
import { AppHeader } from "@/components/app-header"
import { Library } from "@/components/content/library"
import { NodeReaderDialog } from "@/components/participant/node-reader-dialog"
import { TrainingPath } from "@/components/dashboard/training-path"
import { TrailCelebration } from "@/components/dashboard/trail-celebration"
import { LevelBadge, MemberProgress } from "@/components/gamification/member-progress"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BookOpen, Compass, Trophy } from "lucide-react"

import { useGamification } from "@/features/gamification/hooks"
import { useParticipantPortal } from "@/features/participant/hooks"

export default function MembrosPage() {
  const { user: authUser } = useAuth()
  const gamification = useGamification(authUser?.type === "membro")
  const portal = useParticipantPortal("membro", gamification.refresh)
  const { user, nodes, contents } = portal

  const [activeTab, setActiveTab] = useState("trilhas")

  if (!portal.ready || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Carregando...</div>
      </div>
    )
  }

  const salesNodes = nodes.filter(n => n.eixo === "vendas")
  const connectionsNodes = nodes.filter(n => n.eixo === "conexoes")
  const cxNodes = nodes.filter(n => n.eixo === "experiencia")

  const isUserAxis = (axisName: string) => {
    if (!user.eixo) return false
    const parsedEixo = user.eixo.toLowerCase()
    if (axisName === "vendas" && parsedEixo.includes("venda")) return true
    if (axisName === "conexoes" && parsedEixo.includes("conex")) return true
    if (axisName === "experiencia" && (parsedEixo.includes("experi") || parsedEixo.includes("xp"))) return true
    return false
  }

  const officialAxis = normalizeAxis(user.eixo)

  return (
    <main className="min-h-screen bg-background">
      {officialAxis && <TrailCelebration userId={user.id} trail={officialAxis} trailName={axisLabel(officialAxis)} personName={user.name}
        steps={nodes.filter(node => node.eixo === officialAxis)} paused={portal.isReading} />}
      <AppHeader
        icon={Compass}
        title="Portal do Membro"
        subtitle="Trilhas & Aprendizado"
        badges={<>
          {user.eixo && (
            <Badge variant="secondary" className="text-xs bg-primary/10 border-primary/20 text-primary uppercase font-bold">
              {axisLabel(user.eixo)}
            </Badge>
          )}
          <LevelBadge summary={gamification.summary} />
        </>}
      />

      <div className="container mx-auto px-4 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
          <TabsList className="bg-card border border-border">
            <TabsTrigger value="trilhas" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Compass className="h-4 w-4" />
              Trilhas de Desenvolvimento
            </TabsTrigger>
            <TabsTrigger value="biblioteca" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <BookOpen className="h-4 w-4" />
              Biblioteca
            </TabsTrigger>
            <TabsTrigger value="conquistas" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Trophy className="h-4 w-4" />
              Conquistas
            </TabsTrigger>
          </TabsList>

          {/* TAB: Conquistas (pontos, nível e ranking; só para membros) */}
          <TabsContent value="conquistas" className="space-y-6">
            <div className="space-y-2">
              <h2 className="text-2xl font-extrabold text-foreground tracking-tight">Suas conquistas</h2>
              <p className="text-muted-foreground">Pontos e nível vêm das suas notas. Veja suas conquistas e sua posição entre os membros.</p>
            </div>
            <MemberProgress summary={gamification.summary} loading={gamification.loading} error={gamification.error} onRetry={() => void gamification.refresh()} />
          </TabsContent>

          {/* TAB: Trilhas */}
          <TabsContent value="trilhas" className="space-y-8">
            <div className="space-y-2">
              <h2 className="text-2xl font-extrabold text-foreground tracking-tight">Suas Trilhas de Aprendizado</h2>
              <p className="text-muted-foreground">
                Selecione um nó disponível para ler conteúdos ou jogar simuladores. Sua trilha oficial está sinalizada com destaque.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <TrainingPath nodes={salesNodes as any[]} onSelectNode={portal.selectNode} highlighted={isUserAxis("vendas")} axisName="Vendas" />
              <TrainingPath nodes={connectionsNodes as any[]} onSelectNode={portal.selectNode} highlighted={isUserAxis("conexoes")} axisName="Conexões" />
              <TrainingPath nodes={cxNodes as any[]} onSelectNode={portal.selectNode} highlighted={isUserAxis("experiencia")} axisName="Experiência do Consumidor" />
            </div>
          </TabsContent>

          {/* TAB: Biblioteca */}
          <TabsContent value="biblioteca">
            <Library
              contents={contents}
              title="Biblioteca de Materiais"
              description="Filtre materiais por eixo de conhecimento ou pesquise pelo nome."
              axisFilter
              emptyMessage="Nenhum material encontrado neste filtro."
            />
          </TabsContent>
        </Tabs>
      </div>

      <NodeReaderDialog
        open={portal.isReading}
        onOpenChange={portal.setIsReading}
        selectedNode={portal.selectedNode}
        onCompleteMaterial={portal.completeMaterial}
        onSubmitted={async () => {
          await portal.refreshActivities()
          await portal.refreshProgress()
          portal.closeReader()
        }}
      />
    </main>
  )
}
