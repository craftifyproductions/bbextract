import type { SessionLogRecord } from './sessionLogger'
import { getSupabaseClient } from './supabaseClient'
import { isSupabaseConfigured } from './envSettings'

interface ExtractionRunRow {
  id: string
  filename: string
  created_at: string
  user_email?: string | null
  file_count: number
  success_count: number
  error_count: number
  content: string
}

function rowToRecord(row: ExtractionRunRow): SessionLogRecord {
  return {
    id: row.id,
    filename: row.filename,
    createdAt: row.created_at,
    userEmail: row.user_email ?? undefined,
    fileCount: row.file_count,
    successCount: row.success_count,
    errorCount: row.error_count,
    content: row.content,
  }
}

export async function saveLogToSupabase(log: SessionLogRecord): Promise<void> {
  if (!isSupabaseConfigured()) return

  const supabase = await getSupabaseClient()
  if (!supabase) return

  const { error } = await supabase.from('extraction_runs').upsert(
    {
      id: log.id,
      filename: log.filename,
      created_at: log.createdAt,
      user_email: log.userEmail ?? null,
      file_count: log.fileCount,
      success_count: log.successCount,
      error_count: log.errorCount,
      content: log.content,
      source: 'browser',
    },
    { onConflict: 'id' },
  )

  if (error) {
    throw new Error(error.message)
  }
}

export async function listLogsFromSupabase(limit = 50): Promise<SessionLogRecord[]> {
  if (!isSupabaseConfigured()) return []

  const supabase = await getSupabaseClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('extraction_runs')
    .select('id, filename, created_at, user_email, file_count, success_count, error_count, content')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(error.message)
  }

  return (data as ExtractionRunRow[]).map(rowToRecord)
}

export async function getLogFromSupabase(id: string): Promise<SessionLogRecord | null> {
  if (!isSupabaseConfigured()) return null

  const supabase = await getSupabaseClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from('extraction_runs')
    .select('id, filename, created_at, user_email, file_count, success_count, error_count, content')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data ? rowToRecord(data as ExtractionRunRow) : null
}
