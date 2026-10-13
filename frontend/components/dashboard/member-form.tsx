"use client"

import React from "react"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { UserPlus, Eye, EyeOff } from "lucide-react"
import { isMemberEmail, memberAxisLabels, MEMBER_EMAIL_ERROR, type MemberAxis } from "@/lib/roles"

type Cargo = "admin" | "organizador" | "gerente" | "membro" | "trainee"
type Eixo = MemberAxis

interface MemberFormData {
  name: string
  email: string
  cargo: Cargo
  password?: string
  eixo?: Eixo
}

interface MemberFormProps {
  onSubmit: (data: MemberFormData) => void | Promise<void>
  userType?: string
  /** Eixo do gerente logado: ele cadastra membros desse eixo e trainees do PlugInfo. */
  managerAxis?: MemberAxis | null
}

// Perfis que pertencem a um eixo e, por isso, exigem a escolha dele.
const needsAxis = (cargo: Cargo | "") => cargo === "membro" || cargo === "gerente"

export function MemberForm({ onSubmit, userType = "admin", managerAxis = null }: MemberFormProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [cargo, setCargo] = useState<Cargo | "">("")
  const [eixo, setEixo] = useState<Eixo | "">("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Organizador cadastra trainees; gerente, membros do próprio eixo ou trainees.
  useEffect(() => {
    if (userType === "organizador") {
      setCargo("trainee")
      setEixo("")
    } else if (managerAxis) {
      setCargo("membro")
      setEixo(managerAxis)
    }
  }, [userType, managerAxis, open])

  const chooseManagerCargo = (value: "membro" | "trainee") => {
    setCargo(value)
    setEixo(value === "membro" && managerAxis ? managerAxis : "")
  }

  const resetForm = () => {
    setName("")
    setEmail("")
    setPassword("")
    setCargo(userType === "organizador" ? "trainee" : managerAxis ? "membro" : "")
    setEixo(managerAxis ?? "")
    setErrors({})
  }

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (!name.trim()) {
      newErrors.name = "Nome é obrigatório"
    }

    if (!email.trim()) {
      newErrors.email = "Email é obrigatório"
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = "Email inválido"
    } else if (cargo === "membro" && !isMemberEmail(email)) {
      newErrors.email = MEMBER_EMAIL_ERROR
    }

    if (!password) {
      newErrors.password = "Senha é obrigatória"
    } else if (password.length < 6) {
      newErrors.password = "A senha deve ter no mínimo 6 caracteres"
    }

    if (!cargo) {
      newErrors.cargo = "Cargo é obrigatório"
    }

    if (needsAxis(cargo) && !eixo) {
      newErrors.eixo = cargo === "gerente" ? "Escolha o eixo que o gerente vai administrar" : "Eixo é obrigatório para membros"
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) return

    const formData: MemberFormData = {
      name: name.trim(),
      email: email.trim(),
      cargo: cargo as Cargo,
      password: password,
      ...(needsAxis(cargo) && eixo ? { eixo: eixo as Eixo } : {}),
    }

    setSubmitting(true)
    setErrors({})
    try {
      await onSubmit(formData)
      resetForm()
      setOpen(false)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao cadastrar usuário"
      setErrors({ form: msg })
    } finally {
      setSubmitting(false)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      resetForm()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <UserPlus className="h-4 w-4" />
          {userType === "organizador" ? "Cadastrar Trainee" : "Cadastrar Membro"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {userType === "organizador" ? "Cadastrar Novo Trainee"
              : managerAxis ? "Cadastrar Membro ou Trainee" : "Cadastrar Novo Membro"}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Preencha as informações para cadastrar um novo perfil no sistema.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 mt-4">
          {/* Nome */}
          <div className="space-y-2">
            <Label htmlFor="name" className="text-foreground">
              Nome
            </Label>
            <Input
              id="name"
              type="text"
              placeholder="Nome completo"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name}</p>
            )}
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="email" className="text-foreground">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              placeholder={cargo === "membro" ? "nome@infojr.com.br" : "email@exemplo.com"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email}</p>
            )}
          </div>

          {/* Senha */}
          <div className="space-y-2">
            <Label htmlFor="password-field" className="text-foreground">
              Senha
            </Label>
            <div className="relative">
              <Input
                id="password-field"
                type={showPassword ? "text" : "password"}
                placeholder="Digite a senha de acesso"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.password && (
              <p className="text-sm text-destructive">{errors.password}</p>
            )}
          </div>

          {/* Cargo */}
          {managerAxis && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cargo-manager" className="text-foreground">Cargo</Label>
                <Select value={cargo} onValueChange={chooseManagerCargo}>
                  <SelectTrigger id="cargo-manager" className="bg-secondary border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="membro">Membro</SelectItem>
                    <SelectItem value="trainee">Trainee (PlugInfo)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="eixo-locked" className="text-foreground">Eixo</Label>
                <Input id="eixo-locked" value={cargo === "trainee" ? "Trainee (PlugInfo)" : memberAxisLabels[managerAxis]}
                  disabled className="bg-secondary border-border" />
              </div>
            </div>
          )}
          {userType !== "organizador" && !managerAxis && (
            <div className="space-y-2">
              <Label htmlFor="cargo" className="text-foreground">
                Cargo
              </Label>
              <Select
                value={cargo}
                onValueChange={(value: Cargo) => {
                  setCargo(value)
                  if (value === "trainee" || value === "admin" || value === "organizador") {
                    setEixo("")
                  }
                }}
              >
                <SelectTrigger className="bg-secondary border-border text-foreground">
                  <SelectValue placeholder="Selecione o cargo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Administrador</SelectItem>
                  <SelectItem value="organizador">Organizador do PlugInfo</SelectItem>
                  <SelectItem value="gerente">Gerente de eixo</SelectItem>
                  <SelectItem value="membro">Membro</SelectItem>
                  <SelectItem value="trainee">Trainee</SelectItem>
                </SelectContent>
              </Select>
              {errors.cargo && (
                <p className="text-sm text-destructive">{errors.cargo}</p>
              )}
            </div>
          )}

          {/* Eixo - membros e gerentes pertencem a um eixo */}
          {needsAxis(cargo) && !managerAxis && (
            <div className="space-y-2">
              <Label htmlFor="eixo" className="text-foreground">
                {cargo === "gerente" ? "Eixo administrado" : "Eixo"}
              </Label>
              <Select
                value={eixo}
                onValueChange={(value: Eixo) => setEixo(value)}
              >
                <SelectTrigger className="bg-secondary border-border text-foreground">
                  <SelectValue placeholder="Selecione o eixo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vendas">Vendas</SelectItem>
                  <SelectItem value="conexoes">Conexões</SelectItem>
                  <SelectItem value="experiencia">Experiência do Consumidor</SelectItem>
                </SelectContent>
              </Select>
              {errors.eixo && (
                <p className="text-sm text-destructive">{errors.eixo}</p>
              )}
            </div>
          )}

          {/* Erro geral */}
          {errors.form && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
              <p className="text-sm text-destructive">{errors.form}</p>
            </div>
          )}

          {/* Botões */}
          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="border-border text-muted-foreground hover:text-foreground"
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Cadastrando..." : "Cadastrar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
