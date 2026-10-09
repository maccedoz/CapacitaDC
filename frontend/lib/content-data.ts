export type ContentType = "membro" | "trainee"
// "all" é o conteúdo compartilhado com todas as trilhas.
export type Eixo = "vendas" | "conexoes" | "experiencia" | "trainee" | "all"

export interface ContentDocument {
  name: string
  url: string
}

export interface ContentItem {
  id: string
  name: string
  type: ContentType
  eixo: Eixo
  text: string
  documents: ContentDocument[]
  videos: string[]
}

export const eixoLabels: Record<Eixo, string> = {
  vendas: "Vendas",
  conexoes: "Conexões",
  experiencia: "Experiência do Consumidor",
  trainee: "Trainee",
  all: "Todos os eixos",
}

export const eixoColors: Record<Eixo, string> = {
  vendas: "bg-emerald-500/20 text-emerald-400 light:text-emerald-700 border-emerald-500/30",
  conexoes: "bg-blue-500/20 text-blue-400 light:text-blue-700 border-blue-500/30",
  experiencia: "bg-amber-500/20 text-amber-400 light:text-amber-700 border-amber-500/30",
  trainee: "bg-purple-500/20 text-purple-400 light:text-purple-700 border-purple-500/30",
  all: "bg-slate-500/20 text-slate-300 light:text-slate-700 border-slate-500/30",
}

