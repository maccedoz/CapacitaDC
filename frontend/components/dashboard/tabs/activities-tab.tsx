"use client"

import { useState } from "react"
import {
  CheckCircle2, ChevronDown, ChevronUp, ClipboardList, Clock, Gamepad2, Pencil, Plus, Trash2, Upload, XCircle,
} from "lucide-react"
import { groupByEixo } from "@/lib/roles"
import { asUtcDate, utcToLocalInput } from "@/lib/datetime"
import { GameLibrary } from "@/components/games/game-library"
import { CorrectionRow } from "@/components/dashboard/correction-row"
import { ActivityForm, emptyActivityForm, type ActivityFormValues } from "@/components/dashboard/activity-form"
import { useDashboard } from "@/components/dashboard/dashboard-context"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Activity } from "@/features/activities/types"

function deadlineIso(value: string) {
  return value ? new Date(value).toISOString() : null
}

export function ActivitiesTab() {
  const { axis, isOrg, axisName, defaultEixo, contents, activities: activityState, users, activitySubTab, setActivitySubTab } = useDashboard()
  const {
    activities, activitySubmissions, expandedActivity,
    createActivity, updateActivity, toggleActivity, deleteActivity, loadSubmissions, gradeSubmission, deleteSubmission,
  } = activityState
  const refreshUsers = users.refresh

  const [showActivityForm, setShowActivityForm] = useState(false)
  const [editActivityId, setEditActivityId] = useState<string | null>(null)

  const handleCreateActivity = async (form: ActivityFormValues) => {
    try {
      await createActivity({
        title: form.title, description: form.description,
        eixo: form.eixo, accepts_file: form.accepts_file,
        deadline: deadlineIso(form.deadline),
        material_id: form.material_id || null, weight: Number(form.weight),
        allow_retry: form.allow_retry, is_required: form.is_required,
      })
      setShowActivityForm(false)
    } catch (e: any) { alert(e.message || "Erro ao criar atividade") }
  }

  const handleSaveEditActivity = async (activityId: string, form: ActivityFormValues) => {
    try {
      await updateActivity(activityId, {
        title: form.title,
        description: form.description,
        accepts_file: form.accepts_file,
        deadline: deadlineIso(form.deadline),
        material_id: form.material_id || null,
        weight: Number(form.weight),
        allow_retry: form.allow_retry, is_required: form.is_required,
      })
      setEditActivityId(null)
      await refreshUsers()
    } catch (e: any) { alert(e.message || "Erro ao salvar atividade") }
  }

  const handleToggleActivity = async (activityId: string, currentOpen: boolean) => {
    try { await toggleActivity(activityId, currentOpen) } catch (e: any) { alert(e.message) }
  }

  const handleDeleteActivity = async (activityId: string) => {
    if (!confirm("Tem certeza que deseja excluir esta atividade?")) return
    try { await deleteActivity(activityId); await refreshUsers() } catch (e: any) { alert(e.message) }
  }

  const handleLoadSubmissions = async (activityId: string) => {
    try { await loadSubmissions(activityId) } catch (e: any) { console.error(e) }
  }

  const editValues = (act: Activity): ActivityFormValues => ({
    title: act.title,
    description: act.description || "",
    eixo: act.eixo,
    accepts_file: act.accepts_file,
    deadline: act.deadline ? utcToLocalInput(act.deadline) : "",
    material_id: act.material_id || "",
    weight: act.weight ?? 1, allow_retry: act.allow_retry !== false, is_required: act.is_required !== false,
  })

  const formProps = { contents, axis, axisName, isOrg }

  return (
    <Tabs value={activitySubTab} onValueChange={setActivitySubTab} className="space-y-6">
      <TabsList><TabsTrigger value="entregas">Entregas</TabsTrigger><TabsTrigger value="jogos"><Gamepad2 className="mr-2 size-4" />Jogos</TabsTrigger></TabsList>
      <TabsContent value="jogos"><GameLibrary isOrganizer={isOrg} managerAxis={axis} /></TabsContent>
      <TabsContent value="entregas" className="space-y-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-foreground">Atividades</h2>
            <p className="text-muted-foreground text-sm">
              Crie atividades para os trainees/membros enviarem arquivos. Defina prazo e avalie as submissões.
            </p>
          </div>
          <Button size="sm" className="gap-2" onClick={() => setShowActivityForm(v => !v)}>
            <Plus className="h-4 w-4" />
            Nova Atividade
          </Button>
        </div>

        {showActivityForm && (
          <Card className="border-primary/30 bg-card">
            <CardContent className="pt-6">
              <ActivityForm mode="create" initial={emptyActivityForm(defaultEixo)} {...formProps}
                onCancel={() => setShowActivityForm(false)} onSubmit={handleCreateActivity} />
            </CardContent>
          </Card>
        )}

        {activities.length === 0 && (
          <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl">
            <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Nenhuma atividade criada ainda.</p>
          </div>
        )}

        <div className="space-y-8">
          {groupByEixo(activities).map(({ eixo, label, items }) => (
            <div key={eixo} className="space-y-3">
              <h3 className="text-base font-semibold text-foreground border-b border-border pb-2">{label}</h3>
              <div className="space-y-4">
                {items.map((act) => {
                  const isOpen = act.effective_open
                  const isExpanded = expandedActivity === act.id
                  const subs = activitySubmissions[act.id] || []

                  return (
                    <Card key={act.id} className="border-border bg-card">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-sm font-bold text-foreground flex flex-wrap items-center gap-2">
                              {act.title}
                              {isOpen ? (
                                <Badge className="bg-emerald-500/10 text-emerald-400 light:text-emerald-700 border-emerald-500/30 text-[9px]">Aberta</Badge>
                              ) : (
                                <Badge variant="outline" className="text-rose-400 light:text-rose-700 border-rose-500/30 text-[9px]">Fechada</Badge>
                              )}
                              {act.accepts_file && (
                                <Badge variant="outline" className="text-primary border-primary/30 text-[9px]">
                                  <Upload className="h-2.5 w-2.5 mr-0.5" />Arquivo
                                </Badge>
                              )}
                              <Badge variant="outline" className="text-[9px]">{act.is_required === false ? "Opcional" : `Peso ${act.weight ?? 1}`}</Badge>
                              {act.allow_retry === false && <Badge variant="outline" className="text-[9px]">Envio único</Badge>}
                            </CardTitle>
                            {act.description && (
                              <p className="text-xs text-muted-foreground mt-1">{act.description}</p>
                            )}
                            {act.deadline && (
                              <p className="text-[10px] text-amber-400 light:text-amber-700 flex items-center gap-1 mt-1">
                                <Clock className="h-3 w-3" />
                                Prazo: {asUtcDate(act.deadline).toLocaleString("pt-BR")}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Button size="sm" variant="outline" className="text-xs h-7 px-2" onClick={() => setEditActivityId(act.id)}>
                              <Pencil className="h-3 w-3 mr-1" />Editar
                            </Button>
                            <Button size="sm" variant="outline" className="text-xs h-7 px-2" onClick={() => handleToggleActivity(act.id, act.is_open)}>
                              {act.is_open ? <><XCircle className="h-3 w-3 mr-1 text-rose-400 light:text-rose-700" />Fechar</> : <><CheckCircle2 className="h-3 w-3 mr-1 text-emerald-400 light:text-emerald-700" />Abrir</>}
                            </Button>
                            <Button size="sm" variant="outline" className="text-xs h-7 px-2" onClick={() => handleLoadSubmissions(act.id)}>
                              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                              <span className="ml-1">{act.submission_count} envio{act.submission_count !== 1 ? 's' : ''}</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-rose-400 light:text-rose-700 hover:text-rose-300 light:hover:text-rose-800 h-7 w-7 p-0"
                              onClick={() => handleDeleteActivity(act.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </CardHeader>

                      {editActivityId === act.id && (
                        <CardContent className="pt-0">
                          <ActivityForm mode="edit" initial={editValues(act)} {...formProps}
                            onCancel={() => setEditActivityId(null)} onSubmit={form => handleSaveEditActivity(act.id, form)} />
                        </CardContent>
                      )}

                      {isExpanded && (
                        <CardContent className="pt-0 space-y-3">
                          <div className="border-t border-border pt-3">
                            {subs.length === 0 ? (
                              <p className="text-xs text-muted-foreground text-center py-4">Nenhuma submissão ainda.</p>
                            ) : (
                              <div className="space-y-3">
                                {subs.map((sub: any) => (
                                  <CorrectionRow key={sub.id} submission={sub}
                                    onGrade={async (grade, feedback) => {
                                      await gradeSubmission(act.id, sub.id, grade, feedback)
                                      await refreshUsers()
                                    }}
                                    onDelete={async () => {
                                      await deleteSubmission(act.id, sub.id)
                                      await refreshUsers()
                                    }} />
                                ))}
                              </div>
                            )}
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </TabsContent>
    </Tabs>
  )
}
