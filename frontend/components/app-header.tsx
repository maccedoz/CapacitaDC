"use client"

import type { ReactNode } from "react"
import { useRouter } from "next/navigation"
import { LogOut, User, type LucideIcon } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"

interface AppHeaderProps {
  icon: LucideIcon
  title: string
  subtitle: string
  /** Selos ao lado do nome (papel, eixo, nível). */
  badges?: ReactNode
}

/** Cabeçalho comum ao painel da gestão e aos portais de membros e trainees. */
export function AppHeader({ icon: Icon, title, subtitle, badges }: AppHeaderProps) {
  const router = useRouter()
  const { user, logout } = useAuth()

  const handleLogout = () => { logout(); router.push("/login") }

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">{title}</h1>
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {user && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <User className="h-4 w-4" />
                <span className="hidden sm:inline font-medium">{user.name}</span>
                {badges}
              </div>
            )}
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Sair</span>
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
