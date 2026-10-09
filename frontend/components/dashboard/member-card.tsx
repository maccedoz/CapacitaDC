"use client"

import { useRouter } from "next/navigation"
import { UserAvatar } from "@/components/user-avatar"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ExternalLink } from "lucide-react"
import { axisLabel } from "@/lib/roles"

interface MemberCardProps {
  id: string
  name: string
  eixo: string
  cargo: string
  photo?: string
  showProfile?: boolean
}

export function MemberCard({ id, name, eixo, cargo, photo, showProfile = false }: MemberCardProps) {
  const router = useRouter()
  return (
    <Card className="border-border/50 bg-card hover:border-primary/50 transition-all duration-200">
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          <UserAvatar name={name} photo={photo} className="h-12 w-12 border-2 border-primary/30 shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground truncate">{name}</h3>
            <p className="text-sm text-muted-foreground truncate">{cargo}</p>
            <span className="inline-flex items-center px-2 py-0.5 mt-1 text-xs font-medium bg-primary/20 text-primary rounded-full">
              {axisLabel(eixo)}
            </span>
            {showProfile && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 h-6 text-[10px] px-2 text-primary hover:text-primary/80 -ml-1 block"
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
