// features/activities/types.ts — Shared Activity type definitions

export interface SubmissionAttachment {
  id: string
  name: string
  size: number
  url: string
}

export interface AttachmentUploadToken {
  pathname: string
  token: string
}

export interface ActivitySubmission {
  attachments?: SubmissionAttachment[]
  links?: string[]
  id: string
  file_url?: string | null
  comment?: string
  submitted_at?: string | null
  previous_grade?: number | null
  effective_grade?: number | null
  grade?: number | null
  feedback?: string
}

export interface Activity {
  id: string
  title: string
  description?: string
  eixo: string
  material_id?: string | null
  accepts_file: boolean
  /** Prazo efetivo: numa atividade da trilha, o mais tardio das etapas vinculadas. */
  deadline?: string | null
  /** A atividade está numa etapa da trilha: o prazo é definido lá. */
  deadline_from_trail?: boolean
  is_open: boolean
  effective_open: boolean
  submission_count: number
  weight?: number
  allow_retry?: boolean
  is_required?: boolean
  created_by?: string | null
  created_at?: string | null
  my_submission?: ActivitySubmission | null
}

export interface ActivityCreatePayload {
  title: string
  description?: string
  eixo: string
  accepts_file: boolean
  deadline?: string | null
  material_id?: string | null
  weight?: number
  allow_retry?: boolean
  is_required?: boolean
}

export interface ActivityUpdatePayload {
  is_open?: boolean
  deadline?: string | null
  title?: string
  description?: string
  accepts_file?: boolean
  material_id?: string | null
  weight?: number
  allow_retry?: boolean
  is_required?: boolean
}

export interface SubmissionCreatePayload {
  attachment_ids?: string[]
  links?: string[]
  file_url?: string | null
  comment?: string
  node_id?: string | null
}

export interface SubmissionGradePayload {
  grade: number
  feedback?: string
}

export interface ActivitySubmissionOut {
  attachments?: SubmissionAttachment[]
  links?: string[]
  id: string
  activity_id: string
  user_id: string
  file_url?: string | null
  comment?: string
  submitted_at?: string | null
  previous_grade?: number | null
  effective_grade?: number | null
  grade?: number | null
  feedback?: string
  user_name?: string | null
  user_type?: string | null
  activity_title?: string | null
  activity_weight?: number | null
  activity_eixo?: string | null
}

export interface SubmissionQueueFilters {
  status?: "pending" | "graded" | "all"
  user_type?: "trainee" | "membro" | "all"
  eixo?: string
  activity_id?: string
  user_id?: string
  limit?: number
  offset?: number
}
