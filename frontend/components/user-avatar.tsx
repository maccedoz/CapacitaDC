"use client"

import { useEffect, useState } from "react"
import { fetchAuthenticatedBlob } from "@/lib/api-client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

// A foto exige o token da sessão, que um <img> não envia: ela é baixada uma vez
// por versão (a URL muda a cada foto nova) e reaproveitada como object URL.
const photoCache = new Map<string, Promise<string>>()

function photoUrl(url: string): Promise<string> {
  let cached = photoCache.get(url)
  if (!cached) {
    cached = fetchAuthenticatedBlob(url).then(blob => URL.createObjectURL(blob))
    cached.catch(() => photoCache.delete(url))
    photoCache.set(url, cached)
  }
  return cached
}

export function initialsOf(name: string): string {
  return name.split(" ").filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase()
}

interface UserAvatarProps {
  name: string
  /** Caminho da foto na API (`/api/users/{id}/photo?v=...`), ou vazio. */
  photo?: string | null
  className?: string
  fallbackClassName?: string
}

export function UserAvatar({ name, photo, className, fallbackClassName }: UserAvatarProps) {
  const [src, setSrc] = useState<string | null>(null)
  const hasPhoto = !!photo && photo.startsWith("/api/users/")

  useEffect(() => {
    if (!hasPhoto) return
    let active = true
    photoUrl(photo).then(url => { if (active) setSrc(url) }).catch(() => { if (active) setSrc(null) })
    return () => { active = false }
  }, [photo, hasPhoto])

  return (
    <Avatar className={className}>
      {hasPhoto && src && <AvatarImage src={src} alt={name} />}
      <AvatarFallback className={cn("bg-primary/20 text-primary font-semibold", fallbackClassName)}>
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  )
}
