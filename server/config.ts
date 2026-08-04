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
/** Separate RAG corpus bucket (model.json + label.json only). */
export const R2_VECTOR_BUCKET = (process.env.R2_VECTOR_BUCKET ?? 'vector-db').trim()
/** Optional prefix inside the vector bucket (empty = model folders at bucket root). */
export const R2_VECTOR_PREFIX = (process.env.R2_VECTOR_PREFIX ?? '').replace(/^\/+|\/+$/g, '')
export const R2_ENDPOINT =
  process.env.R2_ENDPOINT ??
  (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined)
export const MAX_R2_UPLOAD_BYTES = process.env.R2_MAX_UPLOAD_MB
  ? Number(process.env.R2_MAX_UPLOAD_MB) * 1024 * 1024
  : 0

/** Google AI Studio / Gemini API key — server-only, never expose via VITE_. */
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY
export const GEMINI_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image'
export const GEMINI_LABEL_MODEL =
  process.env.GEMINI_LABEL_MODEL ?? 'gemini-3.1-flash-lite'

/** Gemini Flash-Lite free-tier style caps for RAG batch labeling. */
export const GEMINI_LABEL_RPM = Number(process.env.GEMINI_LABEL_RPM ?? 15)
export const GEMINI_LABEL_TPM = Number(process.env.GEMINI_LABEL_TPM ?? 250_000)
export const GEMINI_LABEL_RPD = Number(process.env.GEMINI_LABEL_RPD ?? 500)

/** Groq API (server-only) for RAG labeling. */
export const GROQ_API_KEY = process.env.GROQ_API_KEY
export const GROQ_LABEL_MODEL = process.env.GROQ_LABEL_MODEL ?? 'llama-3.3-70b-versatile'
/** Groq free-tier style caps (conservative). */
export const GROQ_LABEL_RPM = Number(process.env.GROQ_LABEL_RPM ?? 30)
export const GROQ_LABEL_TPM = Number(process.env.GROQ_LABEL_TPM ?? 12_000)
export const GROQ_LABEL_RPD = Number(process.env.GROQ_LABEL_RPD ?? 14_400)

/** NVIDIA NIM API (server-only) — legacy; RAG labeling now uses OpenRouter. */
export const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY
export const NVIDIA_LABEL_MODEL =
  process.env.NVIDIA_LABEL_MODEL ?? 'nvidia/nemotron-nano-12b-v2-vl'
export const NVIDIA_LABEL_RPM = Number(process.env.NVIDIA_LABEL_RPM ?? 40)
export const NVIDIA_LABEL_TPM = Number(process.env.NVIDIA_LABEL_TPM ?? 100_000)
export const NVIDIA_LABEL_RPD = Number(process.env.NVIDIA_LABEL_RPD ?? 1_000)

/** OpenRouter (server-only) for RAG vision labeling. */
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
export const OPENROUTER_LABEL_MODEL =
  process.env.OPENROUTER_LABEL_MODEL ?? 'google/gemini-3.5-flash'
export const OPENROUTER_LABEL_RPM = Number(process.env.OPENROUTER_LABEL_RPM ?? 20)
export const OPENROUTER_LABEL_TPM = Number(process.env.OPENROUTER_LABEL_TPM ?? 200_000)
export const OPENROUTER_LABEL_RPD = Number(process.env.OPENROUTER_LABEL_RPD ?? 2_000)
export const OPENROUTER_HTTP_REFERER =
  process.env.OPENROUTER_HTTP_REFERER ?? 'https://bbextract.local'
export const OPENROUTER_APP_TITLE = process.env.OPENROUTER_APP_TITLE ?? 'BBExtract RAG Label'

/** Hard safety cap per button-started batch run. */
export const RAG_BATCH_MAX_PER_RUN = Number(process.env.RAG_BATCH_MAX_PER_RUN ?? 100)

/** Cloudflare Worker free image API — server-only. */
export const CF_WORKER_IMAGE_URL = (
  process.env.CF_WORKER_IMAGE_URL ??
  'https://free-image-generation-api.sagnik2000trainstation.workers.dev'
).replace(/\/+$/, '')
export const CF_WORKER_IMAGE_API_KEY = process.env.CF_WORKER_IMAGE_API_KEY

export function isR2Configured(): boolean {
  return Boolean(R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET)
}

export function isR2VectorConfigured(): boolean {
  return Boolean(isR2Configured() && R2_VECTOR_BUCKET)
}

export function isCloudflareWorkerImageConfigured(): boolean {
  return Boolean(CF_WORKER_IMAGE_URL && CF_WORKER_IMAGE_API_KEY?.trim())
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
