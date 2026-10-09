"use client"

import { ContentList } from "@/components/dashboard/content-list"
import type { ContentItem } from "@/components/dashboard/content-card"
import { useDashboard } from "@/components/dashboard/dashboard-context"

function materialPayload(content: ContentItem) {
  return {
    name: content.name, type: content.type, eixo: content.eixo, text: content.text || "",
    documents: (content.documents || []).map((d: any) => ({ name: d.name, url: d.url })),
    videos: content.videos || [],
  }
}

export function MaterialsTab() {
  const { user, axis, isManager, isOrg, axisName, contents, materials } = useDashboard()
  const { createMaterial, updateMaterial, deleteMaterial } = materials

  const handleDeleteContent = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este material?")) return
    try { await deleteMaterial(id) } catch (e: any) { alert(e.message || "Erro ao excluir material") }
  }

  return (
    <>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-foreground">Materiais</h2>
        <p className="text-muted-foreground">
          {isManager ? `Gerencie os materiais dos membros de ${axisName} e dos trainees`
            : isOrg ? "Gerencie os materiais específicos dos Trainees" : "Gerencie os materiais disponíveis para membros e trainees"}
        </p>
      </div>
      <ContentList
        contents={isOrg ? contents.filter(c => c.type === "trainee") : contents}
        onUpdateContent={async updated => { await updateMaterial(updated.id, materialPayload(updated)) }}
        onAddContent={async created => { await createMaterial(materialPayload(created)) }}
        onDeleteContent={handleDeleteContent}
        userType={user.type}
        managerAxis={axis}
      />
    </>
  )
}
