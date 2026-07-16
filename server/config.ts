import { resolve } from 'node:path'

export const PORT = Number(process.env.PORT ?? 3001)
export const SESSION_SECRET = process.env.SESSION_SECRET
export const PASSWORD = process.env.BBEXTRACT_PASSWORD
export const LOGS_DIR = resolve(process.cwd(), 'logs')
export const MAX_LOGS = 5
export const isProduction = process.env.NODE_ENV === 'production'

export const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
export const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY

export const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID
export const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID
export const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY
export const R2_BUCKET = process.env.R2_BUCKET
export const R2_PREFIX = (process.env.R2_PREFIX ?? 'bbextract').replace(/^\/+|\/+$/g, '')
export const R2_ENDPOINT =
  process.env.R2_ENDPOINT ??
  (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined)
export const MAX_R2_UPLOAD_BYTES = process.env.R2_MAX_UPLOAD_MB
  ? Number(process.env.R2_MAX_UPLOAD_MB) * 1024 * 1024
  : 0

export function isR2Configured(): boolean {
  return Boolean(R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET)
}

export function validateConfig(): void {
  if (!PASSWORD) {
    throw new Error(
      'BBEXTRACT_PASSWORD is not set. Add it to your .env file (server-side only — never expose to the frontend).',
    )
  }
  if (!SESSION_SECRET) {
    throw new Error('SESSION_SECRET is not set. Add it to your .env file.')
  }
}
