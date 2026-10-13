"use client"

import { useState } from "react"
import { Trophy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { Achievement } from "@/features/gamification/types"

/** Confirma no servidor apenas os avisos apresentados, para não repetir em outro navegador. */
export function AchievementPopup({ achievements, paused, onAcknowledge }: {
  achievements: Achievement[]
  paused: boolean
  onAcknowledge: (ids: string[]) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const open = !paused && achievements.length > 0
  const dismiss = async () => {
    if (saving || !achievements.length) return
    setSaving(true)
    setError("")
    try { await onAcknowledge(achievements.map(item => item.id)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível confirmar o aviso. Tente novamente.") }
    finally { setSaving(false) }
  }
  return <Dialog open={open} onOpenChange={value => { if (!value) void dismiss() }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" data-testid="achievement-popup">
      <DialogHeader>
        <span className="mb-2 flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary"><Trophy className="size-6" /></span>
        <DialogTitle>{achievements.length === 1 ? "Nova conquista!" : "Novas conquistas!"}</DialogTitle>
        <DialogDescription>Seu esforço rendeu {achievements.length === 1 ? "uma conquista" : `${achievements.length} conquistas`}. Veja o que você alcançou.</DialogDescription>
      </DialogHeader>
      <ul className="space-y-3">{achievements.map(item => <li key={item.id} className="rounded-lg border bg-primary/5 p-3">
        <p className="font-semibold">{item.title}</p><p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
      </li>)}</ul>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button disabled={saving} onClick={() => void dismiss()}>{saving ? "Confirmando…" : "Continuar"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
