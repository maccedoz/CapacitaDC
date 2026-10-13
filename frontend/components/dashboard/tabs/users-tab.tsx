"use client"

import { MemberForm } from "@/components/dashboard/member-form"
import { UsersSection } from "@/components/dashboard/users-section"
import { useDashboard } from "@/components/dashboard/dashboard-context"

export function UsersTab() {
  const { user, axis, isManager, isOrg, axisName, users } = useDashboard()
  const { members, trainees, createUser, updateUser, deleteUser, updateTrainee } = users

  const handleAddMember = async (data: {
    name: string; email: string; cargo: "admin" | "organizador" | "gerente" | "membro" | "trainee";
    password?: string; eixo?: "vendas" | "conexoes" | "experiencia"
  }) => {
    // O cargo escolhido no formulário é o próprio perfil.
    await createUser({ name: data.name, email: data.email, cargo: data.cargo, type: data.cargo, eixo: data.eixo, password: data.password })
  }

  const handleUpdateTrainee = async (traineeId: string, data: { rotacao?: number }) => {
    try { await updateTrainee(traineeId, { rotacao: data.rotacao }) }
    catch (e: any) { alert(e.message || "Erro ao atualizar trainee") }
  }

  const handleUpdateUser = async (userId: string, data: any) => {
    try { await updateUser(userId, data) } catch (e: any) { alert(e.message || "Erro ao atualizar usuário") }
  }

  const handleDeleteUser = async (userId: string) => {
    try { await deleteUser(userId) } catch (e: any) { alert(e.message || "Erro ao excluir usuário") }
  }

  return (
    <>
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-foreground">
            {isManager ? `Membros de ${axisName} e trainees` : isOrg ? "Trainees do PlugInfo" : "Usuários"}
          </h2>
          <p className="text-muted-foreground">
            {isManager ? "Cadastre, edite e acompanhe os membros do seu eixo e os trainees do PlugInfo"
              : isOrg ? "Gerencie e acompanhe os trainees sob sua supervisão" : "Gerencie os membros e trainees do setor comercial"}
          </p>
        </div>
        <MemberForm onSubmit={handleAddMember} userType={user.type} managerAxis={axis} />
      </div>
      <UsersSection
        members={members}
        trainees={trainees}
        showGrades={true}
        showProfiles={true}
        membersTitle={isManager ? `Membros — ${axisName}` : undefined}
        currentUserRole={user.type}
        onUpdateTrainee={handleUpdateTrainee}
        onUpdateUser={handleUpdateUser}
        onDeleteUser={handleDeleteUser}
      />
    </>
  )
}
