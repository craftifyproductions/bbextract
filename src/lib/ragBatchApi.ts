import { fetchWithRetry } from './fetchWithRetry'

export interface RagBatchRateLimit {
  modelId?: string
  provider?: 'openrouter' | 'nvidia'
  rpmLimit: number
  tpmLimit: number
  rpdLimit: number
  rpmUsed: number
  tpmUsed: number
  rpdUsed: number
  rpmRemaining: number
  tpmRemaining: number
  rpdRemaining: number
  rpmPercent: number
  tpmPercent: number
  rpdPercent: number
  nextSlotMs: number
  nextSlotSeconds: number
  rpmResetsInSeconds: number
  tpmResetsInSeconds?: number
  canSendNow: boolean
  date: string
  updatedAt: string
  source: string
  note: string
  liveSynced?: boolean
  publishedCaps?: { rpm: number; tpm: number; rpd: number; source: string }
}

export interface RagLabelModelOption {
  id: string
  label: string
  hint: string
  provider: 'openrouter' | 'nvidia'
  configured?: boolean
  rpm?: number
  tpm?: number
  rpd?: number
  /** USD per 1M prompt tokens (OpenRouter). */
  promptPerMillion?: number
  /** USD per 1M completion tokens (OpenRouter). */
  completionPerMillion?: number
  /** Short display, e.g. "$1.50 / $9.00", "Free", or "NIM API". */
  priceLabel?: string
}

export interface RagBatchState {
  id: string | null
  status: 'idle' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled'
  startedAt: string | null
  finishedAt: string | null
  force: boolean
  dryRun: boolean
  limit: number
  total: number
  completed: number
  skipped: number
  failed: number
  currentModel: string | null
  selectedModel: string
  lastError: string | null
  logs: Array<{ at: string; level: 'info' | 'warn' | 'error'; message: string }>
  results: Array<{ root: string; status: 'done' | 'skipped' | 'failed'; reason?: string }>
  rateLimit: RagBatchRateLimit
  caps: {
    rpm: number
    tpm: number
    rpd: number
    maxPerRun: number
  }
  model: string
  availableModels: RagLabelModelOption[]
  provider: 'openrouter' | 'nvidia'
  providers: { openrouter: boolean; nvidia?: boolean }
  configured: boolean
  vectorBucketConfigured?: boolean
  labelSchemaVersion?: number
  openrouterUsage?: {
    keyLabel: string | null
    usage: number
    usageDaily: number
    usageWeekly: number
    usageMonthly: number
    limit: number | null
    limitRemaining: number | null
    limitReset: string | null
    isFreeTier: boolean
    totalCredits: number | null
    totalUsage: number | null
    balanceRemaining: number | null
    updatedAt: string
  } | null
}

async function getSupabaseBearerToken(): Promise<string | null> {
  try {
    const { getSupabaseClient } = await import('./supabaseClient')
    const supabase = await getSupabaseClient()
    const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } }
    return data.session?.access_token ?? null
  } catch {
    return null
  }
}

async function ragRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getSupabaseBearerToken()
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetchWithRetry(path, {
    ...options,
    credentials: 'include',
    headers,
  })

  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // ignore
    }
    throw new Error(message)
  }

  return response.json() as Promise<T>
}

export function getRagBatchStatus(model?: string): Promise<RagBatchState> {
  const query = model ? `?model=${encodeURIComponent(model)}` : ''
  return ragRequest(`/api/rag/batch/status${query}`)
}

export function startRagBatch(body: {
  limit?: number
  dryRun?: boolean
  model?: string
}): Promise<{ ok: boolean; message: string; state: RagBatchState }> {
  return ragRequest('/api/rag/batch/start', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function cancelRagBatch(): Promise<{ ok: boolean; state: RagBatchState }> {
  return ragRequest('/api/rag/batch/cancel', { method: 'POST' })
}

export function syncRagBatchLimits(model: string): Promise<{
  ok: boolean
  message: string
  state: RagBatchState
}> {
  return ragRequest('/api/rag/batch/sync-limits', {
    method: 'POST',
    body: JSON.stringify({ model }),
  })
}

export interface LabeledLocalModel {
  name: string
  model: Record<string, unknown>
  label: Record<string, unknown>
  texture?: { mimeType: string; data: string; name: string } | null
}

export interface LabelLocalUploadResult {
  ok: boolean
  count: number
  labelModel: string
  sourceFilename: string
  models: LabeledLocalModel[]
}

/** Upload a local .zip / .bbmodel and generate model.json + label.json (no auto download/upload). */
export async function labelLocalUpload(
  file: File,
  model: string,
): Promise<LabelLocalUploadResult> {
  const token = await getSupabaseBearerToken()
  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'X-BBExtract-Filename': file.name,
    'X-BBExtract-Model': model,
  })
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetchWithRetry('/api/rag/label-upload', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: file,
  })

  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // ignore
    }
    throw new Error(message)
  }

  return response.json() as Promise<LabelLocalUploadResult>
}

/** Upload already-labeled model.json + label.json pairs into vector-db. */
export async function uploadLabeledModelsToVectorDb(
  models: LabeledLocalModel[],
): Promise<{ ok: boolean; uploaded: string[]; failed: Array<{ name: string; error: string }>; message: string }> {
  return ragRequest('/api/rag/vector-upload', {
    method: 'POST',
    body: JSON.stringify({ models }),
  })
}
