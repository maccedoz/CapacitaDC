"use client"

import { useState } from "react"
import { Lightbulb, Send } from "lucide-react"
import { asUtcDate } from "@/lib/datetime"
import { SUGGESTION_MAX_LENGTH } from "@/features/suggestions/api"
import { useSuggestions } from "@/features/suggestions/hooks"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"

/** Aba do trainee: envia uma sugestão ou ideia (sempre com o nome) e vê o que já enviou. */
export function TraineeSuggestions() {
  const { suggestions, loading, error, send } = useSuggestions("mine")
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  const submit = async () => {
    setSending(true)
    setStatus(null)
    try {
      await send(text)
      setText("")
      setStatus({ kind: "ok", text: "Sugestão enviada. Obrigado!" })
    } catch (cause) {
      setStatus({ kind: "error", text: cause instanceof Error ? cause.message : "Não foi possível enviar a sugestão." })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold text-foreground">Sugestões e ideias</h2>
        <p className="text-xs text-muted-foreground">
          Conte o que pode melhorar na capacitação. A organização recebe sua mensagem com o seu nome.
        </p>
      </div>

      <Card className="border-border bg-card">
        <CardContent className="pt-6 space-y-3">
          <label htmlFor="suggestion-text" className="text-sm font-medium text-foreground">Sua sugestão</label>
          <Textarea
            id="suggestion-text"
            value={text}
            maxLength={SUGGESTION_MAX_LENGTH}
            onChange={event => setText(event.target.value)}
            placeholder="Escreva sua sugestão ou ideia..."
            className="min-h-28 bg-secondary border-border"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">{text.length}/{SUGGESTION_MAX_LENGTH}</span>
            <Button onClick={submit} disabled={sending || !text.trim()}>
              <Send className="mr-2 size-4" />{sending ? "Enviando..." : "Enviar"}
            </Button>
          </div>
          {status && (
            <p role={status.kind === "error" ? "alert" : "status"}
              className={`text-xs ${status.kind === "error" ? "text-destructive" : "text-emerald-500 light:text-emerald-700"}`}>
              {status.text}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Enviadas por você</h3>
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">Carregando...</p>
        ) : error ? (
          <p role="alert" className="text-sm text-destructive">{error}</p>
        ) : suggestions.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-border rounded-xl text-muted-foreground text-sm">
            <Lightbulb className="h-8 w-8 mx-auto mb-2 opacity-30" />
            Você ainda não enviou sugestões.
          </div>
        ) : (
          <ul className="space-y-2">
            {suggestions.map(item => (
              <li key={item.id} className="rounded-xl border border-border bg-card p-3 space-y-1">
                <p className="text-sm text-foreground whitespace-pre-line">{item.text}</p>
                <p className="text-[11px] text-muted-foreground">Enviada em {asUtcDate(item.created_at).toLocaleString("pt-BR")}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
