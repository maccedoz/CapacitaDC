// lib/roles.ts — Papéis e eixos de membros, com a mesma normalização do servidor.
//
// Registros antigos guardam o nome de exibição ("Conexões"); os novos, o código
// ("conexoes"). A interface compara sempre o código e exibe o nome completo.

export type UserRole = "admin" | "organizador" | "gerente" | "membro" | "trainee"
export type MemberAxis = "vendas" | "conexoes" | "experiencia"

export const memberAxes: MemberAxis[] = ["vendas", "conexoes", "experiencia"]

export const memberAxisLabels: Record<MemberAxis, string> = {
  vendas: "Vendas",
  conexoes: "Conexões",
  experiencia: "Experiência do Consumidor",
}

const axisAliases: Record<string, MemberAxis> = {
  vendas: "vendas",
  conexoes: "conexoes",
  "conexões": "conexoes",
  experiencia: "experiencia",
  "experiência": "experiencia",
  "experiencia do consumidor": "experiencia",
  "experiência do consumidor": "experiencia",
}

export function normalizeAxis(value?: string | null): MemberAxis | null {
  return value ? axisAliases[value.trim().toLocaleLowerCase("pt-BR")] ?? null : null
}

/** Nome para exibir; valores desconhecidos aparecem como estão para serem corrigidos. */
export function axisLabel(value?: string | null): string {
  const axis = normalizeAxis(value)
  return axis ? memberAxisLabels[axis] : value || "—"
}

// Eixos de conteúdo: trainee (PlugInfo), os três eixos de membro e "all" (compartilhado
// com toda trilha). Nomes iguais aos já usados na aba Trilha e no filtro de Correções.
const CONTENT_AXIS_ORDER = ["trainee", ...memberAxes, "all"]
const CONTENT_AXIS_LABELS: Record<string, string> = {
  trainee: "Trainee (Geral)", ...memberAxisLabels, all: "Todos os eixos",
}

/**
 * Separa itens por eixo em seções ordenadas (Trainee, Vendas, Conexões, Experiência,
 * Todos os eixos), preservando a ordem original dentro de cada seção. Um eixo fora
 * dessa lista (dado antigo ou desconhecido) aparece por último, com o próprio valor
 * como rótulo — nunca é descartado silenciosamente.
 */
export function groupByEixo<T>(items: T[], eixoOf: (item: T) => string | null | undefined = (item: any) => item.eixo): Array<{ eixo: string; label: string; items: T[] }> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = eixoOf(item) || "—"
    const bucket = groups.get(key)
    if (bucket) bucket.push(item)
    else groups.set(key, [item])
  }
  const ordered = [...CONTENT_AXIS_ORDER.filter(eixo => groups.has(eixo)),
                   ...[...groups.keys()].filter(eixo => !CONTENT_AXIS_ORDER.includes(eixo))]
  return ordered.map(eixo => ({ eixo, label: CONTENT_AXIS_LABELS[eixo] || eixo, items: groups.get(eixo)! }))
}

export function isStaff(type?: string | null): boolean {
  return type === "admin" || type === "organizador" || type === "gerente"
}

/** Membros são da empresa: o e-mail precisa ser do domínio dela (a API confere o mesmo). */
export const MEMBER_EMAIL_DOMAIN = "@infojr.com.br"
export const MEMBER_EMAIL_ERROR = `E-mail de membro precisa terminar em ${MEMBER_EMAIL_DOMAIN}.`

export function isMemberEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(MEMBER_EMAIL_DOMAIN)
}

/** Eixo administrado por um gerente; null para os demais perfis. */
export function managerAxis(user?: { type: string; eixo?: string | null } | null): MemberAxis | null {
  return user?.type === "gerente" ? normalizeAxis(user.eixo) : null
}

export function homePath(type?: string | null): string {
  if (isStaff(type)) return "/"
  return type === "membro" ? "/membros" : "/trainees"
}
