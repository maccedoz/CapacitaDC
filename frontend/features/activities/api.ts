// features/activities/api.ts — All HTTP calls related to activities

import { apiClient } from "@/lib/api-client"
import type {
  Activity,
  AttachmentUploadToken,
  SubmissionAttachment,
  ActivityCreatePayload,
  ActivityUpdatePayload,
  SubmissionCreatePayload,
  SubmissionGradePayload,
  SubmissionQueueFilters,
  ActivitySubmissionOut,
} from "./types"

export const activitiesApi = {
  // A Vercel recusa corpos acima de 4,5 MB nas funções: o arquivo vai direto para o
  // armazenamento privado com um token da API, que depois confere e registra o envio.
  uploadAttachment: async (activityId: string, file: File, nodeId?: string): Promise<SubmissionAttachment> => {
    const attachments = `/api/activities/${activityId}/attachments`
    const { pathname, token } = await apiClient.post<AttachmentUploadToken>(`${attachments}/upload-token`, {
      name: file.name, size: file.size, node_id: nodeId,
    })
    try {
      // Carregada só ao enviar: a biblioteca somaria ~33 KB (gzip) a cada página com o formulário.
      const { put } = await import("@vercel/blob/client")
      await put(pathname, file, { access: "private", token })
    } catch (cause) {
      throw new Error(`${file.name}: não foi possível enviar o arquivo. Tente novamente.`, { cause })
    }
    return apiClient.post<SubmissionAttachment>(attachments, { pathname, name: file.name, node_id: nodeId })
  },
  list: () => apiClient.get<Activity[]>("/api/activities"),

  create: (payload: ActivityCreatePayload) =>
    apiClient.post<Activity>("/api/activities", payload),

  update: (activityId: string, payload: ActivityUpdatePayload) =>
    apiClient.patch<Activity>(`/api/activities/${activityId}`, payload),

  delete: (activityId: string) =>
    apiClient.delete(`/api/activities/${activityId}`),

  // Fila única de correção, com pendentes primeiro.
  listQueue: (filters: SubmissionQueueFilters = {}) => {
    const query = new URLSearchParams()
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== "" && value !== "all") query.set(key, String(value))
    })
    const suffix = query.toString()
    return apiClient.get<ActivitySubmissionOut[]>(`/api/submissions${suffix ? `?${suffix}` : ""}`)
  },

  getSubmissions: (activityId: string) =>
    apiClient.get<ActivitySubmissionOut[]>(
      `/api/activities/${activityId}/submissions`
    ),

  submit: (activityId: string, payload: SubmissionCreatePayload) =>
    apiClient.post<ActivitySubmissionOut>(
      `/api/activities/${activityId}/submit`,
      payload
    ),

  gradeSubmission: (
    activityId: string,
    submissionId: string,
    payload: SubmissionGradePayload
  ) =>
    apiClient.patch<ActivitySubmissionOut>(
      `/api/activities/${activityId}/submissions/${submissionId}`,
      payload
    ),

  deleteSubmission: (activityId: string, submissionId: string) =>
    apiClient.delete(`/api/activities/${activityId}/submissions/${submissionId}`),

  // Mesma nota (e feedback opcional) para várias entregas; tudo ou nada.
  gradeBatch: (submissionIds: string[], grade: number, feedback: string) =>
    apiClient.post<ActivitySubmissionOut[]>("/api/submissions/grade-batch", {
      submission_ids: submissionIds, grade, feedback,
    }),
}
