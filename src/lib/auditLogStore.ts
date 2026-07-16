import { getSupabaseClient } from './supabaseClient'

export interface AuditEvent {
  id: string
  userEmail?: string | null
  action: string
  subject?: string | null
  details?: Record<string, unknown> | null
  createdAt: string
}

interface AuditEventRow {
  id: string
  user_email?: string | null
  action: string
  subject?: string | null
  details?: Record<string, unknown> | null
  created_at: string
}

function rowToAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    userEmail: row.user_email,
    action: row.action,
    subject: row.subject,
    details: row.details,
    createdAt: row.created_at,
  }
}

export async function recordAuditEvent(
  action: string,
  subject?: string,
  details?: Record<string, unknown>,
): Promise<void> {
  const supabase = await getSupabaseClient()
  if (!supabase) return

  const { data } = await supabase.auth.getUser()
  const { error } = await supabase.from('audit_events').insert({
    user_email: data.user?.email ?? null,
    action,
    subject: subject ?? null,
    details: details ?? null,
  })

  if (error) {
    console.warn('[BBExtract] Failed to write audit event:', error.message)
  }
}

export async function listAuditEvents(limit = 100): Promise<AuditEvent[]> {
  const supabase = await getSupabaseClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('audit_events')
    .select('id, user_email, action, subject, details, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)
  return (data as AuditEventRow[]).map(rowToAuditEvent)
}
