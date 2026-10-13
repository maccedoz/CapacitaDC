/**
 * api-client.ts — Centralized fetch wrapper.
 *
 * Automatically attaches the JWT token from localStorage and parses JSON.
 * All feature-level api.ts files import from here instead of calling fetch directly.
 */

const BASE_URL = ""
export const ACCESS_DENIED_EVENT = "capacita:access-denied"

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = "ApiError"
  }
}

export async function responseError(response: Response): Promise<ApiError> {
  const fallback = response.status === 401
    ? "Sua sessão expirou. Entre novamente para continuar."
    : response.status === 403
      ? "Você não tem permissão para realizar esta ação."
      : response.status === 422
        ? "Confira os dados informados e tente novamente."
        : response.status >= 500
          ? "O servidor está temporariamente indisponível. Tente novamente."
          : "Não foi possível concluir a solicitação."
  let message = fallback
  // Recusas (403) trazem o motivo, como o escopo do gerente; 401 e 5xx ficam genéricos.
  if (response.status < 500 && response.status !== 401) {
    try {
      const body = await response.json()
      if (typeof body.detail === "string") message = body.detail
      else if (Array.isArray(body.detail)) {
        message = body.detail.map((issue: { loc?: string[]; msg?: string }) =>
          `${issue.loc?.filter(part => part !== "body").join(".") || "Dados"}: ${issue.msg || fallback}`
        ).join("; ")
      }
    } catch {
      // Proxies can return HTML instead of the API's JSON error response.
    }
  }
  return new ApiError(response.status, message)
}

function getToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem("token")
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken()

  // FormData leva o próprio Content-Type, com o boundary do multipart.
  const headers: Record<string, string> = {
    ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers as Record<string, string>),
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })

  if (!res.ok) {
    // Uma recusa pode significar que o administrador mudou o papel ou o eixo:
    // a sessão é conferida de novo para a tela refletir o acesso atual.
    if (res.status === 403 && typeof window !== "undefined") window.dispatchEvent(new Event(ACCESS_DENIED_EVENT))
    throw await responseError(res)
  }

  // Some endpoints return 204 No Content or plain text
  const contentType = res.headers.get("content-type") || ""
  if (contentType.includes("application/json")) {
    return res.json() as Promise<T>
  }
  return res.text() as unknown as Promise<T>
}

function isSameOrigin(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin === window.location.origin
  } catch {
    return false
  }
}

// Uploaded files live in private Blob storage, so a plain <a href> can't
// reach them — the request needs the bearer token, hence a fetch + object URL.
// External document links open directly: the token never leaves this site.
export async function openAuthenticatedFile(url: string): Promise<void> {
  if (!isSameOrigin(url)) {
    window.open(url, "_blank", "noopener,noreferrer")
    return
  }
  const token = getToken()
  const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!response.ok) throw await responseError(response)
  const objectUrl = URL.createObjectURL(await response.blob())
  window.open(objectUrl, "_blank", "noopener,noreferrer")
  setTimeout(() => URL.revokeObjectURL(objectUrl), 30000)
}

/** Baixa um arquivo da API com o token da sessão (ex.: foto de perfil para um <img>). */
export async function fetchAuthenticatedBlob(url: string): Promise<Blob> {
  const token = getToken()
  const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!response.ok) throw await responseError(response)
  return response.blob()
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PUT",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PATCH",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  delete: <T = { detail: string }>(path: string) =>
    request<T>(path, { method: "DELETE" }),

  /** Envia um arquivo como multipart (campo "file"). */
  upload: <T>(path: string, file: Blob, filename: string, method: "POST" | "PUT" = "POST") => {
    const body = new FormData()
    body.append("file", file, filename)
    return request<T>(path, { method, body })
  },
}
