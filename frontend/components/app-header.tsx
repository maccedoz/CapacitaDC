"use client"

import { useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, LogOut, UserRound, type LucideIcon } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { ThemeToggle } from "@/components/theme-toggle"
import { UserAvatar } from "@/components/user-avatar"
import { PasswordPrompt } from "@/components/profile/password-prompt"
import { ProfileDialog } from "@/components/profile/profile-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface AppHeaderProps {
  icon: LucideIcon
  title: string
  subtitle: string
  /** Selos ao lado do nome (papel, eixo, nível). */
  badges?: ReactNode
  onProfileOpenChange?: (open: boolean) => void
}

/**
 * Cabeçalho comum ao painel da gestão e aos portais de membros e trainees, com o
 * menu do usuário (Meu perfil, Sair) e o aviso de troca de senha do primeiro acesso.
 */
export function AppHeader({ icon: Icon, title, subtitle, badges, onProfileOpenChange }: AppHeaderProps) {
  const router = useRouter()
  const { user, logout } = useAuth()
  const [profile, setProfile] = useState<{ open: boolean; focusPassword: boolean }>({ open: false, focusPassword: false })
  const openProfile = (open: boolean, focusPassword = false) => {
    setProfile({ open, focusPassword })
    onProfileOpenChange?.(open)
  }

  const handleLogout = () => { logout(); router.push("/login") }

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-foreground truncate">{title}</h1>
              <p className="text-sm text-muted-foreground truncate">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {badges && <div className="hidden md:flex items-center gap-2">{badges}</div>}
            <ThemeToggle />
            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="h-10 gap-2 px-2" aria-label="Menu do usuário">
                    <UserAvatar name={user.name} photo={user.photo} className="h-8 w-8" fallbackClassName="text-xs" />
                    <span className="hidden sm:inline text-sm font-medium text-muted-foreground max-w-40 truncate">{user.name}</span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="space-y-0.5">
                    <p className="truncate">{user.name}</p>
                    <p className="text-xs font-normal text-muted-foreground truncate">{user.email}</p>
                  </DropdownMenuLabel>
                  {badges && <div className="flex md:hidden flex-wrap items-center gap-2 px-2 pb-2">{badges}</div>}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => openProfile(true)}>
                    <UserRound className="mr-2 size-4" />Meu perfil
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleLogout}>
                    <LogOut className="mr-2 size-4" />Sair
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>
      {profile.open && (
        <ProfileDialog open onOpenChange={open => openProfile(open, profile.focusPassword)} focusPassword={profile.focusPassword} />
      )}
      <PasswordPrompt onChangePassword={() => openProfile(true, true)} />
    </header>
  )
}
