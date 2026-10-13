"use client"

import { useState } from "react"
import { FileDown, Link2 } from "lucide-react"
import { responseError } from "@/lib/api-client"
import type { ActivitySubmission, SubmissionAttachment } from "@/features/activities/types"

/** Baixa um anexo privado com o token da sessão. */
export async function downloadAttachment(attachment: SubmissionAttachment): Promise<void> {
  const response = await fetch(attachment.url, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
  if (!response.ok) throw await responseError(response)
  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = attachment.name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

export function submissionLinks(submission: ActivitySubmission): string[] {
  return [...new Set([...(submission.links || []), ...(submission.file_url ? [submission.file_url] : [])])]
}

/** Abre o primeiro anexo (ou, sem anexo, o primeiro link) da entrega. Falso se não houver nada. */
export async function openFirstItem(submission: ActivitySubmission): Promise<boolean> {
  const attachment = submission.attachments?.[0]
  if (attachment) {
    await downloadAttachment(attachment)
    return true
  }
  const link = submissionLinks(submission)[0]
  if (link) {
    window.open(link, "_blank", "noopener,noreferrer")
    return true
  }
  return false
}

export function SubmissionContent({ submission }: { submission: ActivitySubmission }) {
  const [error, setError] = useState("")
  const download = async (attachment: SubmissionAttachment) => {
    setError("")
    try { await downloadAttachment(attachment) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível baixar o anexo.") }
  }
  const links = submissionLinks(submission)
  return <div className="space-y-2">
    {submission.previous_grade != null && <p className="text-xs font-medium">Melhor nota: {(submission.effective_grade ?? submission.previous_grade).toFixed(2)} / 10{submission.grade == null ? " · nova entrega aguardando correção" : ""}</p>}
    {(submission.attachments || []).map(attachment => <button key={attachment.id} type="button"
      onClick={() => void download(attachment)} className="flex max-w-full items-center gap-2 text-left text-xs text-primary hover:underline">
      <FileDown className="size-4 shrink-0" /><span className="break-all">{attachment.name}</span>
      <span className="shrink-0 text-muted-foreground">({(attachment.size / 1024 / 1024).toFixed(1)} MB)</span>
    </button>)}
    {links.map(link => <a key={link} href={link} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-1 break-all text-xs text-primary hover:underline"><Link2 className="size-3 shrink-0" />{link}</a>)}
    {submission.comment && <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{submission.comment}</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>
}
