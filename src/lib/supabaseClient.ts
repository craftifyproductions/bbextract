import type { SupabaseClient } from '@supabase/supabase-js'
import { isSupabaseConfigured, loadEnvSettings } from './envSettings'

let client: SupabaseClient | null = null

export async function getSupabaseClient(): Promise<SupabaseClient | null> {
  if (!isSupabaseConfigured()) {
    client = null
    return null
  }

  if (client) return client

  const { createClient } = await import('@supabase/supabase-js')
  const settings = loadEnvSettings()
  client = createClient(settings.supabaseUrl, settings.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  })
  return client
}

export function resetSupabaseClient(): void {
  client = null
}

export async function testSupabaseConnection(): Promise<{ ok: boolean; message: string }> {
  const supabase = await getSupabaseClient()
  if (!supabase) {
    return { ok: false, message: 'Authentication and storage are not configured.' }
  }

  const { error } = await supabase.from('extraction_runs').select('id').limit(1)
  if (error) {
    return { ok: false, message: error.message }
  }

  return { ok: true, message: 'Connected — extraction_runs table is reachable.' }
}
