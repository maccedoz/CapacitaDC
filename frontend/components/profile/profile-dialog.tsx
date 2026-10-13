"use client"

import { useRef, useState } from "react"
import { Camera, KeyRound, Trash2 } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { profileApi, squarePhoto } from "@/features/profile/api"
import { UserAvatar } from "@/components/user-avatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

const MIN_PASSWORD = 6

type Status = { kind: "ok" | "error"; text: string } | null

function StatusLine({ status }: { status: Status }) {
  if (!status) return null
  return (
    <p role={status.kind === "error" ? "alert" : "status"}
      className={`text-xs ${status.kind === "error" ? "text-destructive" : "text-emerald-500 light:text-emerald-700"}`}>
      {status.text}
    </p>
  )
}

const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback

interface ProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Abre já na troca de senha (vindo do popup do primeiro acesso). */
  focusPassword?: boolean
}

/** Meu perfil: nome e foto da própria pessoa, e troca da própria senha. */
export function ProfileDialog({ open, onOpenChange, focusPassword = false }: ProfileDialogProps) {
  const { user, setCurrentUser, applySession } = useAuth()
  const fileInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(user?.name ?? "")
  const [nameStatus, setNameStatus] = useState<Status>(null)
  const [photoStatus, setPhotoStatus] = useState<Status>(null)
  const [passwordStatus, setPasswordStatus] = useState<Status>(null)
  const [busy, setBusy] = useState<"name" | "photo" | "password" | null>(null)
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" })

  if (!user) return null

  const saveName = async () => {
    setBusy("name"); setNameStatus(null)
    try {
      setCurrentUser(await profileApi.updateName(name))
      setNameStatus({ kind: "ok", text: "Nome salvo." })
    } catch (error) { setNameStatus({ kind: "error", text: message(error, "Não foi possível salvar o nome.") }) }
    finally { setBusy(null) }
  }

  const choosePhoto = async (file: File | undefined) => {
    if (!file) return
    setBusy("photo"); setPhotoStatus(null)
    try {
      setCurrentUser(await profileApi.uploadPhoto(await squarePhoto(file)))
      setPhotoStatus({ kind: "ok", text: "Foto atualizada." })
    } catch (error) { setPhotoStatus({ kind: "error", text: message(error, "Não foi possível enviar a foto.") }) }
    finally {
      setBusy(null)
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  const removePhoto = async () => {
    setBusy("photo"); setPhotoStatus(null)
    try {
      setCurrentUser(await profileApi.deletePhoto())
      setPhotoStatus({ kind: "ok", text: "Foto removida." })
    } catch (error) { setPhotoStatus({ kind: "error", text: message(error, "Não foi possível remover a foto.") }) }
    finally { setBusy(null) }
  }

  const changePassword = async () => {
    setPasswordStatus(null)
    if (passwords.next.length < MIN_PASSWORD) {
      setPasswordStatus({ kind: "error", text: `A nova senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.` })
      return
    }
    if (passwords.next !== passwords.confirm) {
      setPasswordStatus({ kind: "error", text: "A confirmação não confere com a nova senha." })
      return
    }
    setBusy("password")
    try {
      const session = await profileApi.changePassword(passwords.current, passwords.next)
      applySession(session.access_token, session.user)
      setPasswords({ current: "", next: "", confirm: "" })
      setPasswordStatus({ kind: "ok", text: "Senha trocada. As outras sessões abertas foram encerradas." })
    } catch (error) { setPasswordStatus({ kind: "error", text: message(error, "Não foi possível trocar a senha.") }) }
    finally { setBusy(null) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Meu perfil</DialogTitle>
          <DialogDescription>E-mail, cargo e eixo são mantidos pela gestão.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-4">
          <UserAvatar name={user.name} photo={user.photo} className="h-16 w-16 border-2 border-primary/30" />
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy === "photo"} onClick={() => fileInput.current?.click()}>
                <Camera className="mr-2 size-4" />{user.photo ? "Trocar foto" : "Enviar foto"}
              </Button>
              {user.photo && (
                <Button size="sm" variant="ghost" disabled={busy === "photo"} onClick={removePhoto}>
                  <Trash2 className="mr-2 size-4" />Remover
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">JPEG, PNG ou WebP. A foto é recortada em quadrado.</p>
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
              aria-label="Escolher foto de perfil" onChange={event => void choosePhoto(event.target.files?.[0])} />
            <StatusLine status={photoStatus} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="profile-name">Nome</Label>
          <div className="flex gap-2">
            <Input id="profile-name" value={name} onChange={event => setName(event.target.value)} />
            <Button onClick={saveName} disabled={busy === "name" || !name.trim() || name.trim() === user.name}>Salvar</Button>
          </div>
          <StatusLine status={nameStatus} />
        </div>

        <Separator />

        <div className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2"><KeyRound className="size-4" />Trocar senha</h3>
          <div className="space-y-1">
            <Label htmlFor="current-password">Senha atual</Label>
            <Input id="current-password" type="password" autoComplete="current-password" autoFocus={focusPassword}
              value={passwords.current} onChange={event => setPasswords(p => ({ ...p, current: event.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-password">Nova senha</Label>
            <Input id="new-password" type="password" autoComplete="new-password"
              value={passwords.next} onChange={event => setPasswords(p => ({ ...p, next: event.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="confirm-password">Confirmar nova senha</Label>
            <Input id="confirm-password" type="password" autoComplete="new-password"
              value={passwords.confirm} onChange={event => setPasswords(p => ({ ...p, confirm: event.target.value }))} />
          </div>
          <StatusLine status={passwordStatus} />
          <Button className="w-full" onClick={changePassword} disabled={busy === "password" || !passwords.current || !passwords.next}>
            {busy === "password" ? "Trocando..." : "Trocar senha"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
