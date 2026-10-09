// features/audit/labels.ts — Textos em português do histórico, num só lugar.
//
// O servidor grava códigos de ação em inglês ("activity.update") e os campos alterados
// com nomes em português ({"título": {"antes": ..., "depois": ...}}). Aqui eles viram
// frases ("editou a atividade “Relatório”") e valores legíveis.

import { asUtcDate } from "@/lib/datetime"
import { axisLabel } from "@/lib/roles"
import type { AuditChange, AuditDetails, AuditEntry } from "./types"

/** Grupos do filtro "tipo de ação", pelo tipo de registro. */
export const AUDIT_GROUPS = [
  { value: "submission", label: "Correções" },
  { value: "activity", label: "Atividades" },
  { value: "node", label: "Trilha" },
  { value: "user", label: "Pessoas" },
  { value: "material", label: "Materiais" },
  { value: "game", label: "Jogos" },
] as const

/** Nome curto de cada ação, para rótulos e para ações sem frase própria. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "submission.grade": "Correção de entrega",
  "submission.grade_batch": "Correção em lote",
  "submission.delete": "Exclusão de entrega",
  "activity.create": "Atividade criada",
  "activity.update": "Atividade editada",
  "activity.delete": "Atividade excluída",
  "node.create": "Etapa criada",
  "node.update": "Etapa editada",
  "node.link_activity": "Atividade vinculada à etapa",
  "node.release": "Liberação de etapa",
  "node.reorder": "Etapa reordenada",
  "node.delete": "Etapa excluída",
  "user.create": "Pessoa cadastrada",
  "user.update": "Cadastro editado",
  "user.rotation": "Rotação do trainee",
  "user.delete": "Pessoa excluída",
  "material.create": "Material criado",
  "material.update": "Material editado",
  "material.delete": "Material excluído",
  "game.create": "Jogo criado",
  "game.update": "Rascunho de jogo editado",
  "game.publish": "Jogo publicado",
  "game.duplicate": "Jogo duplicado",
  "game.delete": "Jogo excluído",
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  organizador: "Organizador do PlugInfo",
  gerente: "Gerente",
  membro: "Membro",
  trainee: "Trainee",
}

const NODE_TYPE_LABELS: Record<string, string> = { activity: "atividade", material: "material", game: "jogo" }

/** Escopo do registro: o eixo do conteúdo ou da pessoa. */
export function scopeLabel(eixo: string | null): string {
  if (!eixo) return "—"
  if (eixo === "trainee") return "PlugInfo"
  if (eixo === "all") return "Todos os eixos"
  return axisLabel(eixo)
}

export function isChange(value: unknown): value is AuditChange {
  return !!value && typeof value === "object" && "antes" in value && "depois" in value
}

function change(details: AuditDetails | null, field: string): AuditChange | null {
  const value = details?.[field]
  return isChange(value) ? value : null
}

/** Valor de um campo para exibir: datas no horário local, sim/não, eixos e perfis pelo nome. */
export function formatAuditValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return value ? "sim" : "não"
  if (typeof value === "number") return value.toLocaleString("pt-BR")
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
      return asUtcDate(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    }
    if (field === "eixo") return scopeLabel(value)
    if (field === "perfil") return ROLE_LABELS[value] ?? value
    if (field === "tipo") return NODE_TYPE_LABELS[value] ?? value
    return value
  }
  return JSON.stringify(value)
}

/** Linhas da área de detalhes: "Campo: antes → depois" ou "Campo: valor". */
export function detailLines(details: AuditDetails | null): Array<{ field: string; before?: string; after: string }> {
  if (!details) return []
  return Object.entries(details)
    .filter(([field]) => field !== "lote")
    .map(([field, value]) => {
      const label = field.charAt(0).toLocaleUpperCase("pt-BR") + field.slice(1)
      return isChange(value)
        ? { field: label, before: formatAuditValue(field, value.antes), after: formatAuditValue(field, value.depois) }
        : { field: label, after: formatAuditValue(field, value) }
    })
}

const quoted = (name: string | null) => `“${name || "sem nome"}”`

/** Frase da ação, sem o sujeito (quem fez aparece ao lado). */
export function describeAudit(entry: AuditEntry): string {
  const { details } = entry
  const name = quoted(entry.entity_name)
  const person = entry.target_user_name || "uma pessoa excluída"
  switch (entry.action) {
    case "submission.grade":
    case "submission.grade_batch": {
      const grade = change(details, "nota")
      const batch = entry.action === "submission.grade_batch" || details?.lote === true
      let text = `corrigiu a entrega de ${person} em ${name}`
      if (grade) {
        const after = formatAuditValue("nota", grade.depois)
        text += grade.antes === null || grade.antes === undefined
          ? ` — nota ${after}`
          : ` — nota ${formatAuditValue("nota", grade.antes)} → ${after}`
      }
      return batch ? `${text} (em lote)` : text
    }
    case "submission.delete": return `excluiu a entrega de ${person} em ${name}`
    case "activity.create": return `criou a atividade ${name}`
    case "activity.update": return `editou a atividade ${name}`
    case "activity.delete": return `excluiu a atividade ${name}`
    case "node.create": return `criou a etapa ${name}`
    case "node.update": return `editou a etapa ${name}`
    case "node.link_activity": {
      const activity = change(details, "atividade")?.depois
      return activity ? `vinculou a atividade “${activity}” à etapa ${name}` : `vinculou uma atividade à etapa ${name}`
    }
    case "node.release": {
      if (change(details, "liberado")?.depois === false) return `bloqueou a etapa ${name}`
      const scheduled = change(details, "liberação")?.depois
      return scheduled ? `agendou a liberação da etapa ${name} para ${formatAuditValue("liberação", scheduled)}` : `liberou a etapa ${name}`
    }
    case "node.reorder": {
      const position = change(details, "posição")
      return position
        ? `moveu a etapa ${name} da posição ${position.antes} para a ${position.depois}`
        : `reordenou a etapa ${name}`
    }
    case "node.delete": return `excluiu a etapa ${name}`
    case "user.create": return `cadastrou ${person}`
    case "user.update": {
      const password = details?.senha !== undefined
      const others = Object.keys(details ?? {}).some(field => field !== "senha")
      if (password && !others) return `redefiniu a senha de ${person}`
      return password ? `editou o cadastro de ${person} e redefiniu a senha` : `editou o cadastro de ${person}`
    }
    case "user.rotation": {
      const rotation = change(details, "rotação")?.depois
      return rotation ? `passou ${person} para a rotação ${rotation}` : `alterou a rotação de ${person}`
    }
    case "user.delete": return `excluiu ${person}`
    case "material.create": return `criou o material ${name}`
    case "material.update": return `editou o material ${name}`
    case "material.delete": return `excluiu o material ${name}`
    case "game.create": return `criou o jogo ${name}`
    case "game.update": return `editou o rascunho do jogo ${name}`
    case "game.publish": {
      const version = details?.["versão"]
      return version ? `publicou a versão ${version} do jogo ${name}` : `publicou o jogo ${name}`
    }
    case "game.duplicate": {
      const source = details?.origem
      return source ? `duplicou o jogo “${source}” como ${name}` : `duplicou o jogo ${name}`
    }
    case "game.delete": return `excluiu o jogo ${name}`
    default: {
      const label = AUDIT_ACTION_LABELS[entry.action] ?? entry.action
      return entry.entity_name ? `${label}: ${name}` : label
    }
  }
}
