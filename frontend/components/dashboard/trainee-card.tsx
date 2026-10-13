"use client"

import { useRouter } from "next/navigation"
import { UserAvatar } from "@/components/user-avatar"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Star, ExternalLink } from "lucide-react"

interface TraineeCardProps {
  id: string
  name: string
  photo?: string
  notaRotacao?: number
  rotacao?: number | null
  showGrade?: boolean  // only true for admin/organizador
  showProfile?: boolean
}

export function TraineeCard({ id, name, photo, notaRotacao, rotacao, showGrade = false, showProfile = false }: TraineeCardProps) {
  const router = useRouter()
  return (
    <Card className="border-border/50 bg-card hover:border-primary/50 transition-all duration-200">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <UserAvatar name={name} photo={photo} className="h-10 w-10 border-2 border-muted shrink-0" fallbackClassName="bg-muted text-muted-foreground font-medium" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1">
              <h3 className="font-medium text-foreground truncate text-sm">{name}</h3>
              {rotacao && (
                <Badge
                  variant="outline"
                  className={`text-[9px] shrink-0 ${
                    rotacao === 1
                      ? "border-sky-500/30 text-sky-400 light:text-sky-700"
                      : "border-violet-500/30 text-violet-400 light:text-violet-700"
                  }`}
                >
                  R{rotacao}
                </Badge>
              )}
            </div>
            <span className="text-xs text-muted-foreground">Trainee</span>

            {showGrade && (
              <div className="mt-2">
                {notaRotacao !== undefined ? (
                  <div className="flex items-center gap-2">
                    <Star className="h-3.5 w-3.5 text-amber-400 light:text-amber-700" />
                    <span className="text-xs text-muted-foreground">Nota:</span>
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        notaRotacao >= 8
                          ? "border-emerald-500/30 text-emerald-400 light:text-emerald-700"
                          : notaRotacao >= 6
                          ? "border-amber-500/30 text-amber-400 light:text-amber-700"
                          : "border-rose-500/30 text-rose-400 light:text-rose-700"
                      }`}
                    >
                      {notaRotacao.toFixed(2)}
                    </Badge>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground/60 italic">Sem nota ainda</span>
                )}
              </div>
            )}

            {showProfile && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 h-6 text-[10px] px-2 text-primary hover:text-primary/80 -ml-1"
                onClick={() => router.push(`/perfil/${id}`)}
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                Ver Perfil
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
