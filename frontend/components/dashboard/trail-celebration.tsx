"use client"

import { useEffect, useMemo, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { PartyPopper } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type Step = { id: string; completed: boolean; is_required?: boolean }

const COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6"]
// Fixed layout: the same balloons on every render, spread across the screen.
const BALLOONS = Array.from({ length: 16 }, (_, index) => ({
  left: `${(index * 37 + 7) % 96}%`,
  color: COLORS[index % COLORS.length],
  delay: `${(index % 5) * 0.35}s`,
  duration: `${4.5 + (index % 4) * 0.6}s`,
  drift: `${(index % 2 ? 1 : -1) * (12 + (index % 3) * 10)}px`,
  scale: 0.8 + (index % 3) * 0.15,
}))

/**
 * The trail is complete when every required step is; a trail with only optional
 * steps needs all of them. Returns the completed set, or null while incomplete.
 */
export function completedTrailSignature(steps: Step[]): string | null {
  const required = steps.filter(step => step.is_required !== false)
  const counted = required.length ? required : steps
  if (!counted.length || counted.some(step => !step.completed)) return null
  return counted.map(step => step.id).sort().join(",")
}

/**
 * Congratulates once per completed set of steps: new steps finished later celebrate again.
 * While `paused` (another dialog is open) it waits, so dialogs never stack.
 */
export function TrailCelebration({ userId, trail, trailName, personName, steps, paused = false, onOpenChange }: {
  userId: string; trail: string; trailName: string; personName?: string; steps: Step[]; paused?: boolean; onOpenChange?: (open: boolean) => void
}) {
  const signature = useMemo(() => completedTrailSignature(steps), [steps])
  const [open, setOpen] = useState(false)
  const storageKey = `trail-celebrated:${userId}:${trail}`

  useEffect(() => {
    if (!signature || paused) return
    try {
      if (localStorage.getItem(storageKey) === signature) return
      localStorage.setItem(storageKey, signature)
    } catch { /* Without storage the celebration may repeat on a later visit. */ }
    setOpen(true)
    onOpenChange?.(true)
  }, [signature, storageKey, paused, onOpenChange])

  const changeOpen = (value: boolean) => { setOpen(value); onOpenChange?.(value) }

  const firstName = personName?.trim().split(/\s+/)[0]
  return <>
    {open && typeof document !== "undefined" && createPortal(
      <div aria-hidden="true" data-testid="trail-balloons" className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
        {BALLOONS.map((balloon, index) => <span key={index} className="trail-balloon" style={{
          left: balloon.left, "--balloon-delay": balloon.delay, "--balloon-duration": balloon.duration,
          "--balloon-drift": balloon.drift, "--balloon-scale": balloon.scale,
        } as CSSProperties}>
          <span className="trail-balloon-body" style={{ background: balloon.color }} />
          <span className="trail-balloon-string" />
        </span>)}
      </div>, document.body)}
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="text-center sm:max-w-md">
        <DialogHeader className="items-center sm:text-center">
          <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary"><PartyPopper className="size-8" /></span>
          <DialogTitle className="text-2xl">Parabéns{firstName ? `, ${firstName}` : ""}!</DialogTitle>
          <DialogDescription className="text-base">Você concluiu todas as etapas da trilha {trailName}. Excelente trabalho!</DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-center"><Button onClick={() => changeOpen(false)}>Continuar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
