export type User = { id: string; email: string }

export type AuthResponse = User & { access_token: string; token_type: string }

export type Note = {
  id: string
  title: string
  content: string
  task_id?: string | null
  source_type?: string | null
  generation_client?: 'mobile' | 'desktop' | 'web' | null
  status: string
  created_at: string
  updated_at: string
  version?: number
}

export type TaskStatus = {
  task_id?: string
  status: string
  message?: string
  stage?: string
  progress?: number
  result?: { task_id: string; title: string; markdown: string }
}
