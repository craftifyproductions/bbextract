import { checkR2Health } from './api'
import { getSupabaseClient } from './supabaseClient'

const UPLOAD_PREFLIGHT_TABLES = ['extraction_runs', 'extracted_models', 'extracted_files'] as const

/**
 * Runs once per upload session (not once per ZIP chunk).
 * Call ensureReady() before processing files; reset() when the session finishes.
 */
export class UploadPreflightGate {
  private ready = false
  private inFlight: Promise<void> | null = null

  get isReady(): boolean {
    return this.ready
  }

  async ensureReady(): Promise<void> {
    if (this.ready) return

    if (!this.inFlight) {
      this.inFlight = this.runChecks()
        .then(() => {
          this.ready = true
        })
        .finally(() => {
          this.inFlight = null
        })
    }

    await this.inFlight
  }

  reset(): void {
    this.ready = false
    this.inFlight = null
  }

  private async runChecks(): Promise<void> {
    const supabase = await getSupabaseClient()
    if (!supabase) {
      throw new Error('Supabase is not configured. Upload persistence is unavailable.')
    }

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    if (sessionError) throw new Error(`Supabase session check failed: ${sessionError.message}`)
    if (!sessionData.session) {
      throw new Error('Sign in to Supabase before uploading files.')
    }

    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError) throw new Error(`Supabase session verification failed: ${userError.message}`)
    if (!userData.user) {
      throw new Error('Supabase session verification failed. Sign in again before uploading files.')
    }

    for (const table of UPLOAD_PREFLIGHT_TABLES) {
      const { error } = await supabase.from(table).select('id').limit(1)
      if (error) {
        throw new Error(`Supabase ${table} table is not reachable: ${error.message}`)
      }
    }

    const health = await checkR2Health()
    if (!health.ok) {
      throw new Error('Cloudflare R2 health check failed.')
    }
  }
}
