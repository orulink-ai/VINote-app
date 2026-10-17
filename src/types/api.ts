export type User = { id: string; email: string }

export type AuthResponse = User & { access_token: string; token_type: string }

export type Note = {
  bilibili_source?: import('./bilibili').BilibiliSource
  id: string
  content_id?: string
  title: string
  content: string
  task_id?: string | null
  source_type?: string | null
  generation_client?: 'mobile' | 'desktop' | 'web' | null
  status: string
  created_at: string
  updated_at: string
  version?: number
  workspace_key?: string
  workspace_revision?: number
  workspace_version_id?: string
  source_device?: string
  archived?: boolean
  project?: string | null
  tags?: string[]
  deleted?: boolean
  transcript?: { full_text?: string; segments?: Array<{ start: number; end: number; text: string; speaker_id?: string; speaker_label?: string; timestamp_estimated?: boolean }>; aliases?: Record<string, string>; speaker_intervals?: Array<{ start: number; end: number; speaker_id?: string; overlap: boolean }> } | null
}

export type TaskStatus = {
  task_id?: string
  status: string
  message?: string
  stage?: string
  progress?: number
  result?: { task_id: string; title: string; markdown: string }
}
