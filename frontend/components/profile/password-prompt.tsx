"use client"

import { useState } from "react"
import { KeyRound } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { profileApi } from "@/features/profile/api"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/**
 * Primeiro acesso (ou senha redefinida pela gestão): sugere trocar a senha, sem obrigar.
 * Qualquer das duas escolhas encerra o aviso no servidor.
 */
export function PasswordPrompt({ onChangePassword }: { onChangePassword: () => void }) {
  const { user, setCurrentUser } = useAuth()
  const [dismissed, setDismissed] = useState(false)

  if (!user?.password_prompt_pending || dismissed) return null

  const dismiss = async () => {
    setDismissed(true)
    try { setCurrentUser(await profileApi.dismissPasswordPrompt()) }
    catch (error) { console.error("Erro ao dispensar o aviso de senha:", error) }
  }

  return (
    <AlertDialog open onOpenChange={open => { if (!open) void dismiss() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2"><KeyRound className="size-5 text-primary" />Quer trocar sua senha?</AlertDialogTitle>
          <AlertDialogDescription>
            Sua senha foi definida pela administração. Você pode trocá-la agora por uma só sua, ou depois, em Meu perfil.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => void dismiss()}>Agora não</AlertDialogCancel>
          <AlertDialogAction onClick={() => { void dismiss(); onChangePassword() }}>Trocar senha</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
