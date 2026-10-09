"use client"

import { useState } from "react"
import { asUtcDate } from "@/lib/datetime"
import { AppHeader } from "@/components/app-header"
import { Library } from "@/components/content/library"
import { TraineeSuggestions } from "@/components/suggestions/trainee-suggestions"
import { NodeReaderDialog } from "@/components/participant/node-reader-dialog"
import { TrainingPath } from "@/components/dashboard/training-path"
import { TrailCelebration } from "@/components/dashboard/trail-celebration"
import { ActivitySubmissionForm } from "@/components/activities/submission-form"
import { SubmissionContent } from "@/components/activities/submission-content"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  BookOpen, CheckCircle2, ClipboardList, Clock, Compass, GraduationCap, Lightbulb, Upload, XCircle,
} from "lucide-react"

import { useParticipantPortal } from "@/features/participant/hooks"

export default function TraineesPage() {
  const portal = useParticipantPortal("trainee")
  const { user, nodes, activities, contents } = portal

  const [activeTab, setActiveTab] = useState("trilha")

  if (!portal.ready || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Carregando...</div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-background">
      <TrailCelebration userId={user.id} trail="trainee" trailName="Trainee" personName={user.name} steps={nodes} paused={portal.isReading} />
      <AppHeader
        icon={GraduationCap}
        title="Portal do Trainee"
        subtitle="Capacitação"
        badges={
          <Badge variant="outline" className="text-amber-400 light:text-amber-700 border-amber-400/30">
            Trainee
          </Badge>
        }
      />

      <div className="container mx-auto px-4 py-8 space-y-8">
        {/* Welcome Info Box */}
        <div className="bg-gradient-to-r from-card to-secondary/30 border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-full bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
                <GraduationCap className="h-6 w-6 text-amber-500 light:text-amber-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground mb-0.5">
                  Olá, {user?.name}!
                </h2>
                <p className="text-xs text-muted-foreground">
                  Avance pelos módulos da trilha comercial e complete as atividades propostas.
                </p>
              </div>
            </div>

          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
          <TabsList className="bg-card border border-border">
            <TabsTrigger value="trilha" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Compass className="h-4 w-4" />
              Trilha de Capacitação
            </TabsTrigger>
            <TabsTrigger value="atividades" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <ClipboardList className="h-4 w-4" />
              Atividades
              {activities.filter(a => a.effective_open && !a.my_submission).length > 0 && (
                <Badge className="ml-1 bg-amber-500 text-white text-[9px] px-1.5 py-0 h-4">
                  {activities.filter(a => a.effective_open && !a.my_submission).length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="biblioteca" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <BookOpen className="h-4 w-4" />
              Biblioteca
            </TabsTrigger>
            <TabsTrigger value="sugestoes" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Lightbulb className="h-4 w-4" />
              Sugestões
            </TabsTrigger>
          </TabsList>

          {/* TAB: Trilha */}
          <TabsContent value="trilha" className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-foreground">Sua Jornada de Capacitação</h2>
              <p className="text-xs text-muted-foreground">
                Conclua cada etapa para desbloquear a próxima. Nós com cadeado estão bloqueados ou aguardando liberação pelo admin.
              </p>
            </div>

            <div className="flex justify-center py-6 bg-card rounded-2xl border border-border">
              <TrainingPath nodes={nodes as any[]} onSelectNode={portal.selectNode} highlighted={true} />
            </div>
          </TabsContent>

          {/* TAB: Atividades */}
          <TabsContent value="atividades" className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-foreground">Atividades</h2>
              <p className="text-xs text-muted-foreground">
                Envie seus anexos e, abaixo, adicione links e comentários. Algumas atividades exigem pelo menos um anexo.
              </p>
            </div>

            {activities.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl">
                <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Nenhuma atividade disponível no momento.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {activities.map((activity) => {
                  const isOpen = activity.effective_open
                  const submitted = !!activity.my_submission

                  return (
                    <Card key={activity.id} className={`border-border bg-card ${
                      submitted ? "border-emerald-500/30" : isOpen ? "" : "opacity-60"
                    }`}>
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-base font-bold text-foreground">{activity.title}</CardTitle>
                            {activity.description && (
                              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{activity.description}</p>
                            )}
                          </div>
                          <div className="flex flex-col gap-1.5 items-end shrink-0">
                            {isOpen ? (
                              <Badge className="bg-emerald-500/10 text-emerald-400 light:text-emerald-700 border-emerald-500/30 text-[10px]">
                                <CheckCircle2 className="h-3 w-3 mr-1" />Aberta
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-rose-400 light:text-rose-700 border-rose-500/30 text-[10px]">
                                <XCircle className="h-3 w-3 mr-1" />Encerrada
                              </Badge>
                            )}
                            {activity.accepts_file && (
                              <Badge variant="outline" className="text-primary border-primary/30 text-[10px]">
                                <Upload className="h-3 w-3 mr-1" />Envio obrigatório
                              </Badge>
                            )}
                          </div>
                        </div>
                        {activity.deadline && (
                          <p className="text-[10px] text-amber-400 light:text-amber-700 flex items-center gap-1 mt-1">
                            <Clock className="h-3 w-3" />
                            Prazo: {asUtcDate(activity.deadline).toLocaleString("pt-BR")}
                          </p>
                        )}
                      </CardHeader>

                      <CardContent className="space-y-3">
                        {submitted && activity.my_submission && (
                          <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-3 space-y-1">
                            <p className="text-xs font-semibold text-emerald-400 light:text-emerald-700">✓ Enviado</p>
                            <SubmissionContent submission={activity.my_submission} />
                            {activity.my_submission.grade !== null && activity.my_submission.grade !== undefined && (
                              <div className="pt-2 border-t border-emerald-500/20">
                                <p className="text-xs font-bold text-emerald-400 light:text-emerald-700">Nota: {activity.my_submission.grade.toFixed(1)}</p>
                                {activity.my_submission.feedback && (
                                  <p className="text-xs text-muted-foreground">{activity.my_submission.feedback}</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {isOpen && (
                          <ActivitySubmissionForm activity={activity} onSubmitted={async () => {
                            await portal.refreshActivities()
                            await portal.refreshProgress()
                          }} />
                        )}
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </TabsContent>

          {/* TAB: Biblioteca */}
          <TabsContent value="biblioteca">
            <Library
              contents={contents.filter(c => c.eixo === "trainee" || c.eixo === "all")}
              title="Biblioteca de Trainees"
              description="Consulte os materiais didáticos da sua capacitação."
              emptyMessage="Nenhum material encontrado."
            />
          </TabsContent>

          {/* TAB: Sugestões */}
          <TabsContent value="sugestoes">
            <TraineeSuggestions />
          </TabsContent>
        </Tabs>
      </div>

      <NodeReaderDialog
        open={portal.isReading}
        onOpenChange={portal.setIsReading}
        selectedNode={portal.selectedNode}
        badge="Capacitação Geral"
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
