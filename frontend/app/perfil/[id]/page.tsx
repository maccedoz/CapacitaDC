"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { ThemeToggle } from "@/components/theme-toggle"
import { axisLabel, homePath, isStaff } from "@/lib/roles"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ArrowLeft, User, BookOpen, Gamepad2, Check,
  ClipboardList, Link2, Award, Clock, Loader2
} from "lucide-react"

import { SubmissionContent } from "@/components/activities/submission-content"
import type { SubmissionAttachment } from "@/features/activities/types"

interface NodeProgress {
  node_id: string
  node_name: string
  node_type: string
  completed: boolean
  score: number
  grade?: number | null
  weight?: number
  is_required?: boolean
  completed_at?: string | null
}

interface ActivitySubmission {
  attachments?: SubmissionAttachment[]
  links?: string[]
  id: string
  activity_id: string
  user_id: string
  file_url?: string | null
  comment?: string
  submitted_at?: string | null
  grade?: number | null
  previous_grade?: number | null
  effective_grade?: number | null
  feedback?: string
  user_name?: string
  activity_title?: string | null
  activity_weight?: number | null
}

interface UserProfile {
  id: string
  name: string
  email: string
  cargo: string
  type: string
  eixo?: string | null
  rotacao?: number | null
  nota_rotacao?: number | null
  pontos_acumulados: number
  node_progress: NodeProgress[]
  activity_submissions: ActivitySubmission[]
}

export default function PerfilPage() {
  const router = useRouter()
  const localParams = useParams()
  const { user, isLoading } = useAuth()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  const userId = (localParams?.id as string) || ""

  const fetchProfile = async () => {
    const token = localStorage.getItem("token")
    if (!token || !userId || userId === "[id]") return
    setLoading(true)
    try {
      console.log(`[PerfilPage] Fetching profile for userId: ${userId}`)
      const res = await fetch(`/api/users/${userId}/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data: UserProfile = await res.json()
        setProfile(data)
      } else {
        console.error(`[PerfilPage] Failed to fetch profile: ${res.status}`)
        router.push("/")
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isLoading) {
      if (!user) {
        router.push("/login")
      } else if (!isStaff(user.type)) {
        router.push(homePath(user.type))
      } else if (userId && userId !== "[id]") {
        fetchProfile()
      }
    }
  }, [isLoading, user, userId])

  if (isLoading || loading || !userId || userId === "[id]") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!profile) return null

  const completedNodes = profile.node_progress.filter(n => n.completed)
  const totalNodes = profile.node_progress.length
  const pct = totalNodes > 0 ? Math.round((completedNodes.length / totalNodes) * 100) : 0
  const isTrainee = profile.type === "trainee"

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Button>
          <div>
            <h1 className="text-lg font-bold text-foreground">Perfil do Usuário</h1>
            <p className="text-xs text-muted-foreground">Visível apenas para a equipe de gestão</p>
          </div>
          <ThemeToggle className="ml-auto" />
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-4xl space-y-8">
        {/* User Info Card */}
        <Card className="border-border bg-card">
          <CardContent className="pt-6">
            <div className="flex items-start gap-6">
              <div className="h-16 w-16 rounded-2xl bg-primary/20 flex items-center justify-center shrink-0">
                <User className="h-8 w-8 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-2xl font-bold text-foreground">{profile.name}</h2>
                  {isTrainee && profile.rotacao && (
                    <Badge variant="outline" className={`${profile.rotacao === 1 ? "border-sky-500/30 text-sky-400 light:text-sky-700" : "border-violet-500/30 text-violet-400 light:text-violet-700"}`}>
                      Rotação {profile.rotacao}
                    </Badge>
                  )}
                  <Badge variant="outline" className="capitalize border-primary/30 text-primary">
                    {profile.type}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{profile.email}</p>
                <p className="text-sm text-muted-foreground">{profile.cargo}{profile.eixo ? ` · ${axisLabel(profile.eixo)}` : ""}</p>

                {/* Stats row — only for trainee / membro */}
                {(profile.type === "trainee" || profile.type === "membro") && (
                <div className="flex flex-wrap gap-6 mt-4">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Trilha</p>
                    <p className="text-lg font-black text-foreground">{pct}%</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Média Ponderada</p>
                    {profile.nota_rotacao != null ? (
                      <p className={`text-lg font-black ${profile.nota_rotacao >= 7 ? "text-emerald-400 light:text-emerald-700" : profile.nota_rotacao >= 5 ? "text-amber-400 light:text-amber-700" : "text-rose-400 light:text-rose-700"}`}>
                        {profile.nota_rotacao.toFixed(2)}
                      </p>
                    ) : (
                      <p className="text-lg font-black text-muted-foreground">—</p>
                    )}
                  </div>
                </div>
                )}

              </div>

            </div>
          </CardContent>
        </Card>

        {/* Trail Progress — only for trainee / membro */}
        {(profile.type === "trainee" || profile.type === "membro") && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              Progresso na Trilha
              <span className="text-xs font-normal text-muted-foreground ml-auto">
                {completedNodes.length}/{totalNodes} completados
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {profile.node_progress.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Nenhum progresso registrado.</p>
            ) : (
              <div className="space-y-2">
                {profile.node_progress.map((np) => (
                  <div key={np.node_id} className={`flex items-center justify-between p-2.5 rounded-lg border transition-colors ${np.completed ? "border-emerald-500/20 bg-emerald-500/5" : "border-border bg-secondary/30"}`}>
                    <div className="flex items-center gap-2">
                      {np.completed
                        ? <Check className="h-4 w-4 text-emerald-400 light:text-emerald-700 shrink-0" />
                        : np.node_type === "game"
                        ? <Gamepad2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        : <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                      }
                      <span className="text-xs font-medium text-foreground">{np.node_name}</span>
                      <Badge variant="outline" className="text-[9px] capitalize border-border/50">
                        {np.node_type}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      {np.node_type === "game" && np.grade != null && <span className="font-semibold">Nota: {np.grade.toFixed(2)} / 10 · {np.is_required === false ? "opcional" : `peso ${np.weight ?? 1}`}</span>}
                      {np.completed && np.completed_at && (
                        <span className="text-muted-foreground/60 text-[10px]">
                          {new Date(np.completed_at).toLocaleDateString("pt-BR")}
                        </span>
                      )}
                      {!np.completed && <span className="text-muted-foreground/50">Pendente</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        )}

        {/* Activity Submissions — only for trainee / membro */}
        {(profile.type === "trainee" || profile.type === "membro") && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" />
              Entregas de Atividades
              <span className="text-xs font-normal text-muted-foreground ml-auto">
                {profile.activity_submissions.length} envio(s)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {profile.activity_submissions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Nenhuma atividade enviada ainda.</p>
            ) : (
              <div className="space-y-3">
                {profile.activity_submissions.map((sub) => (
                  <div key={sub.id} className="rounded-xl border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <ClipboardList className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-semibold text-foreground">{sub.activity_title || "Atividade"}</span>
                        {sub.activity_weight != null && (
                          <span className="text-[10px] text-muted-foreground">peso {sub.activity_weight}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {sub.grade != null ? (
                          <Badge className="bg-emerald-500/10 text-emerald-400 light:text-emerald-700 border-emerald-500/30 text-[9px]">
                            <Award className="h-2.5 w-2.5 mr-0.5" />{sub.grade.toFixed(1)}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-400 light:text-amber-700 border-amber-500/30 text-[9px]">Aguardando avaliação</Badge>
                        )}
                        {sub.submitted_at && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <Clock className="h-3 w-3" />
                            {new Date(sub.submitted_at).toLocaleString("pt-BR")}
                          </span>
                        )}
                      </div>
                    </div>
                    <SubmissionContent submission={sub} />
                    {sub.feedback && (
                      <div className="rounded-lg bg-primary/5 border border-primary/10 p-2">
                        <p className="text-[10px] font-semibold text-primary mb-0.5">Feedback:</p>
                        <p className="text-xs text-muted-foreground">{sub.feedback}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        )}
      </div>
    </div>
  )
}
