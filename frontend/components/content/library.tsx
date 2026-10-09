"use client"

import { useState } from "react"
import { Search } from "lucide-react"
import { type ContentItem } from "@/lib/content-data"
import { ViewContentCard } from "@/components/content/view-content-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const AXIS_FILTERS = [
  { id: "todos", name: "Todos" },
  { id: "trainee", name: "Trainee (Geral)" },
  { id: "vendas", name: "Vendas" },
  { id: "conexoes", name: "Conexões" },
  { id: "experiencia", name: "Experiência" },
]

const KIND_FILTERS = [
  { id: "todos", name: "Todos os tipos" },
  { id: "video", name: "Com vídeo" },
  { id: "documento", name: "Com documento" },
  { id: "texto", name: "Só texto" },
] as const

type Kind = (typeof KIND_FILTERS)[number]["id"]

/** Minúsculas e sem acento, para "conexao" achar "Conexão". */
function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")
}

function matchesKind(content: ContentItem, kind: Kind): boolean {
  const hasVideo = (content.videos?.length ?? 0) > 0
  const hasDocument = (content.documents?.length ?? 0) > 0
  if (kind === "video") return hasVideo
  if (kind === "documento") return hasDocument
  if (kind === "texto") return !hasVideo && !hasDocument
  return true
}

function matchesSearch(content: ContentItem, query: string): boolean {
  if (!query) return true
  const haystack = [content.name, content.text, ...(content.documents ?? []).map(doc => doc.name)].join(" ")
  return normalize(haystack).includes(query)
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <Button
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={onClick}
      aria-pressed={active}
      className={`text-xs h-8 rounded-lg ${active ? "bg-primary text-primary-foreground hover:bg-primary/95" : "hover:bg-secondary/80 border-border"}`}
    >
      {children}
    </Button>
  )
}

interface LibraryProps {
  contents: ContentItem[]
  title: string
  description: string
  /** Mostra os botões de eixo (portal dos membros). */
  axisFilter?: boolean
  emptyMessage: string
}

/**
 * Biblioteca de materiais dos participantes: busca no nome, no texto e nos nomes dos
 * documentos, filtro por tipo e, para membros, por eixo. Materiais compartilhados
 * ("Todos os eixos") aparecem em qualquer eixo escolhido.
 */
export function Library({ contents, title, description, axisFilter = false, emptyMessage }: LibraryProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedEixo, setSelectedEixo] = useState("todos")
  const [kind, setKind] = useState<Kind>("todos")

  const query = normalize(searchQuery.trim())
  const filtered = contents.filter(content =>
    (selectedEixo === "todos" || content.eixo === selectedEixo || content.eixo === "all")
    && matchesKind(content, kind)
    && matchesSearch(content, query))

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Pesquisar no nome, texto ou documentos..."
            aria-label="Pesquisar materiais"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-secondary border-border text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="space-y-2 pb-2 border-b border-border">
        {axisFilter && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por eixo">
            {AXIS_FILTERS.map(e => (
              <FilterButton key={e.id} active={selectedEixo === e.id} onClick={() => setSelectedEixo(e.id)}>{e.name}</FilterButton>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por tipo">
          {KIND_FILTERS.map(k => (
            <FilterButton key={k.id} active={kind === k.id} onClick={() => setKind(k.id)}>{k.name}</FilterButton>
          ))}
        </div>
      </div>

      <div className="grid gap-4">
        {filtered.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-xl text-muted-foreground text-sm">
            {emptyMessage}
          </div>
        ) : (
          filtered.map((content) => <ViewContentCard key={content.id} content={content} />)
        )}
      </div>
    </div>
  )
}
