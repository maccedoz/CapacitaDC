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

interface LibraryProps {
  contents: ContentItem[]
  title: string
  description: string
  /** Mostra os botões de eixo (portal dos membros). */
  axisFilter?: boolean
  emptyMessage: string
}

/** Biblioteca de materiais dos participantes, com busca e filtro opcional por eixo. */
export function Library({ contents, title, description, axisFilter = false, emptyMessage }: LibraryProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedEixo, setSelectedEixo] = useState("todos")

  const byAxis = selectedEixo === "todos" ? contents : contents.filter(c => c.eixo === selectedEixo)
  const filtered = byAxis.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))

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
            placeholder="Pesquisar..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-secondary border-border text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {axisFilter && (
        <div className="flex flex-wrap gap-2 pb-2 border-b border-border">
          {AXIS_FILTERS.map((e) => (
            <Button
              key={e.id}
              variant={selectedEixo === e.id ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedEixo(e.id)}
              className={`text-xs h-8 rounded-lg ${
                selectedEixo === e.id
                  ? "bg-primary text-primary-foreground hover:bg-primary/95"
                  : "hover:bg-secondary/80 border-border"
              }`}
            >
              {e.name}
            </Button>
          ))}
        </div>
      )}

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
