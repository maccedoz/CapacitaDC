"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import { ACCESS_DENIED_EVENT, responseError } from "./api-client"
import type { UserRole } from "./roles"

export type UserType = UserRole

export interface User {
  id: string
  name: string
  email: string
  cargo: string
  type: UserType
  eixo?: string
  photo?: string
  nota_rotacao?: number
  pontos_acumulados?: number
  /** A senha foi definida pela gestão e a pessoa ainda não trocou nem dispensou o aviso. */
  password_prompt_pending?: boolean
}

interface AuthContextType {
  user: User | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string; user?: User }>
  logout: () => void
  refreshUser: () => Promise<void>
  /** Atualiza o usuário da sessão depois de uma alteração feita por ele mesmo. */
  setCurrentUser: (user: User) => void
  /** Troca o token da sessão (a troca de senha derruba os tokens antigos). */
  applySession: (token: string, user: User) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const logout = useCallback(() => {
    setUser(null)
    localStorage.removeItem("currentUser")
    localStorage.removeItem("token")
  }, [])

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem("token")
    if (!token) return
    const res = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
    // An earlier request must not overwrite a newer login or logout.
    if (localStorage.getItem("token") !== token) return
    if (res.status === 401) {
      logout()
      return
    }
    if (!res.ok) throw await responseError(res)
    const userData = await res.json()
    const serialized = JSON.stringify(userData)
    // Mesmo conteúdo, mesmo objeto: conferir a sessão não dispara efeitos à toa.
    setUser(previous => previous && JSON.stringify(previous) === serialized ? previous : userData)
    localStorage.setItem("currentUser", serialized)
  }, [logout])

  useEffect(() => {
    const token = localStorage.getItem("token")
    const storedUser = localStorage.getItem("currentUser")
    if (token && storedUser) {
      try {
        setUser(JSON.parse(storedUser))
      } catch {
        localStorage.removeItem("currentUser")
      }
    }
    refreshUser()
      .catch(error => console.error("Erro ao validar sessão:", error))
      .finally(() => setIsLoading(false))
  }, [refreshUser])

  // O administrador pode trocar o papel ou o eixo de quem já está logado. A sessão
  // é conferida ao voltar para a aba e depois de uma recusa da API; se mudou, as
  // telas que dependem do papel se recriam a partir do usuário atualizado.
  useEffect(() => {
    const check = () => {
      refreshUser().catch(error => console.error("Erro ao validar sessão:", error))
    }
    const onVisible = () => { if (document.visibilityState === "visible") check() }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener(ACCESS_DENIED_EVENT, check)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener(ACCESS_DENIED_EVENT, check)
    }
  }, [refreshUser])

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string; user?: User }> => {
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      })

      if (response.ok) {
        const data = await response.json()
        setUser(data.user)
        localStorage.setItem("token", data.access_token)
        localStorage.setItem("currentUser", JSON.stringify(data.user))
        return { success: true, user: data.user }
      } else {
        return { success: false, error: response.status === 401
          ? "Email ou senha incorretos"
          : (await responseError(response)).message }
      }
    } catch (error) {
      console.error("Erro de login:", error)
      return { success: false, error: "Erro de conexão com o servidor" }
    }
  }

  const setCurrentUser = useCallback((updated: User) => {
    setUser(updated)
    localStorage.setItem("currentUser", JSON.stringify(updated))
  }, [])

  const applySession = useCallback((token: string, updated: User) => {
    localStorage.setItem("token", token)
    setCurrentUser(updated)
  }, [setCurrentUser])

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, refreshUser, setCurrentUser, applySession }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
