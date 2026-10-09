"use client"

import { openAuthenticatedFile } from "@/lib/api-client"
import { asUtcDate } from "@/lib/datetime"
import { LinkedText, safeHref } from "@/components/content/linked-text"
import { ActivitySubmissionForm } from "@/components/activities/submission-form"
import { SubmissionContent } from "@/components/activities/submission-content"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ClipboardList, Clock, ExternalLink, FileText, Video } from "lucide-react"
import { useNodeContent } from "@/features/nodes/hooks"

interface NodeReaderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedNode: any | null
  /** Texto do selo no topo; sem ele, mostra o eixo do material ou da atividade. */
  badge?: string
  onCompleteMaterial: () => void
  onSubmitted: () => Promise<void>
}

/** Leitor de uma etapa da trilha: material, recursos e a entrega da atividade. */
export function NodeReaderDialog({ open, onOpenChange, selectedNode, badge, onCompleteMaterial, onSubmitted }: NodeReaderDialogProps) {
  const { content: nodeContent, loading: contentLoading, error: contentError, refresh: refreshNodeContent } = useNodeContent(
    open ? selectedNode?.id ?? null : null
  )
  const relatedActivity = nodeContent?.activity
  const activeMaterial = nodeContent?.material

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-card border-border text-foreground">
        <DialogHeader>
          <DialogTitle className="text-xl font-extrabold mt-2 leading-tight">
            {activeMaterial?.name || selectedNode?.name || "Material de Capacitação"}
          </DialogTitle>
          <DialogDescription className="sr-only">Conteúdo e atividades da etapa selecionada na trilha.</DialogDescription>
        </DialogHeader>
        {contentLoading || (!nodeContent && !contentError) ? (
          <p role="status" className="py-8 text-center text-sm text-muted-foreground">Carregando conteúdo...</p>
        ) : contentError ? (
          <div className="space-y-4 py-8 text-center">
            <p role="alert" className="text-sm text-destructive">{contentError}</p>
            <Button variant="outline" onClick={() => void refreshNodeContent()}>Tentar novamente</Button>
          </div>
        ) : activeMaterial || relatedActivity ? (
          <>
            <div className="flex items-center justify-between">
              <Badge className="bg-primary/20 text-primary border-primary/30 uppercase tracking-widest text-[9px] font-extrabold">
                {badge ?? (activeMaterial?.eixo || relatedActivity?.eixo)}
              </Badge>
            </div>

            <div className="space-y-6 mt-4">
              {/* Texto */}
              {activeMaterial?.text && (
                <div className="prose prose-sm dark:prose-invert max-w-none bg-muted p-5 rounded-xl border border-border leading-relaxed text-sm text-foreground whitespace-pre-line font-medium">
                  <LinkedText text={activeMaterial.text} />
                </div>
              )}

              {/* Vídeos e Links */}
              {((activeMaterial?.videos && activeMaterial?.videos.length > 0) ||
                (activeMaterial?.documents && activeMaterial?.documents.length > 0)) && (
                <div className="space-y-4">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground">Recursos Adicionais</h4>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Vídeos */}
                    {activeMaterial?.videos?.filter(vidUrl => safeHref(vidUrl)).map((vidUrl, i) => (
                      <a
                        key={i}
                        href={safeHref(vidUrl)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 p-3 bg-secondary rounded-xl hover:bg-secondary/80 border border-border text-xs font-semibold transition"
                      >
                        <div className="bg-rose-500/10 text-rose-500 light:text-rose-600 p-2 rounded-lg">
                          <Video className="w-4 h-4" />
                        </div>
                        <span className="flex-1 truncate">Vídeo de Apoio {i + 1}</span>
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                      </a>
                    ))}

                    {/* Documentos */}
                    {activeMaterial?.documents?.map((doc, i) => (
                      // Documentos enviados ficam em armazenamento privado: a abertura
                      // passa pelo download autenticado, que confere o acesso à etapa.
                      <button
                        key={i}
                        type="button"
                        onClick={() => void openAuthenticatedFile(doc.url).catch(error => alert(error instanceof Error ? error.message : "Não foi possível abrir o documento."))}
                        className="flex items-center gap-3 p-3 bg-secondary rounded-xl hover:bg-secondary/80 border border-border text-xs font-semibold transition text-left"
                      >
                        <div className="bg-primary/10 text-primary p-2 rounded-lg">
                          <FileText className="w-4 h-4" />
                        </div>
                        <span className="flex-1 truncate">{doc.name}</span>
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Related Activity Section */}
              {relatedActivity && (
                <div className="mt-6 border-t border-border pt-4 space-y-4">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <ClipboardList className="w-4 h-4 text-primary" /> Atividade Requerida: {relatedActivity.title}
                  </h4>
                  {relatedActivity.description && (
                    <p className="text-xs text-muted-foreground bg-secondary/50 p-3 rounded-lg border border-border">
                      {relatedActivity.description}
                    </p>
                  )}
                  {(selectedNode?.deadline || relatedActivity.deadline) && (
                    <p className="text-[10px] text-amber-400 light:text-amber-700 flex items-center gap-1 font-semibold">
                      <Clock className="w-3.5 h-3.5" /> Prazo de entrega: {asUtcDate(selectedNode?.deadline || relatedActivity.deadline).toLocaleString("pt-BR")}
                    </p>
                  )}

                  {/* Submission status or form */}
                  {relatedActivity.my_submission ? (
                    <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-3 space-y-2">
                      <p className="text-xs font-semibold text-emerald-400 light:text-emerald-700">✓ Atividade Enviada</p>
                      <SubmissionContent submission={relatedActivity.my_submission} />
                      {relatedActivity.my_submission.grade !== null && relatedActivity.my_submission.grade !== undefined && (
                        <div className="pt-2 border-t border-emerald-500/20">
                          <p className="text-xs font-bold text-emerald-400 light:text-emerald-700">Nota: {relatedActivity.my_submission.grade.toFixed(1)}</p>
                          {relatedActivity.my_submission.feedback && (
                            <p className="text-xs text-muted-foreground">{relatedActivity.my_submission.feedback}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {/* If open and not submitted, show the inputs */}
                  {relatedActivity.effective_open && (
                    <ActivitySubmissionForm activity={relatedActivity} nodeId={selectedNode.id} onSubmitted={onSubmitted} />
                  )}
                </div>
              )}

              {/* Ações */}
              <div className="flex justify-end pt-4 border-t border-border gap-3">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Fechar Leitor
                </Button>
                {selectedNode?.type === "material" && (!relatedActivity || relatedActivity.my_submission) && (
                  <Button onClick={onCompleteMaterial} disabled={nodeContent?.node.completed}>
                    {nodeContent?.node.completed ? "Já concluído" : "Concluir etapa"}
                  </Button>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-4 py-8 text-center text-sm text-muted-foreground">
            <p role="status">{!selectedNode?.reference_id && !selectedNode?.activity_id
              ? "Esta etapa está sem conteúdo vinculado. Avise o responsável pela trilha para associar o material ou a atividade."
              : "O conteúdo desta etapa não está disponível. Ele pode ter sido removido ou ter o acesso alterado."}</p>
            <Button variant="outline" onClick={() => void refreshNodeContent()}>Tentar novamente</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
