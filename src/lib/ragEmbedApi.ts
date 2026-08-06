import { fetchWithRetry } from './fetchWithRetry'

export interface EmbedModelOption {
  id: string
  label: string
  hint?: string
  provider?: 'openrouter' | 'nvidia'
  configured?: boolean
  promptPerMillion?: number
  priceLabel?: string
  nativeDims?: number
}

export interface EmbedJobState {
  status: 'idle' | 'running' | 'cancelling' | 'completed' | 'failed'
  selectedModel: string
  force: boolean
  limit: number
  total: number
  completed: number
  skipped: number
  failed: number
  currentFolder: string | null
  lastError: string | null
  startedAt: string | null
  finishedAt: string | null
  logs: Array<{ at: string; level: 'info' | 'warn' | 'error'; message: string }>
  embeddingDims: number
  maxPerRun: number
  availableModels: EmbedModelOption[]
  packCount: number | null
  indexedCount: number | null
  configured: boolean
  autoEmbedEnabled?: boolean
  rateLimit?: {
    rpmLimit: number
    tpmLimit: number
    rpdLimit: number
    rpmUsed: number
    tpmUsed: number
    rpdUsed: number
    rpmRemaining: number
    tpmRemaining: number
    rpdRemaining: number
    nextSlotSeconds: number
    canSendNow: boolean
  }
  providers: {
    openrouter: boolean
    nvidia?: boolean
    supabaseService: boolean
    vectorBucket: boolean
  }
}

export interface EmbedSearchMatch {
  id: string
  r2_folder_key: string
  description: string
  category: string
  subcategory: string | null
  has_animation: boolean
  has_metadata: boolean
  embedding_model: string | null
  similarity: number
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

async function embedRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getSupabaseBearerToken()
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetchWithRetry(path, {
    ...options,
    credentials: 'include',
    headers,
  })

  const body = (await response.json()) as T & { error?: string }
  if (!response.ok) {
    throw new Error(body.error || `Request failed (${response.status})`)
  }
  return body
}

export async function getEmbedStatus(model?: string): Promise<EmbedJobState> {
  const query = model ? `?model=${encodeURIComponent(model)}` : ''
  return embedRequest(`/api/rag/embed/status${query}`)
}

export async function startEmbedJob(payload: {
  model: string
  limit: number
  force?: boolean
}): Promise<{ ok: boolean; state: EmbedJobState }> {
  return embedRequest('/api/rag/embed/start', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function cancelEmbedJob(): Promise<{ ok: boolean; state: EmbedJobState }> {
  return embedRequest('/api/rag/embed/cancel', { method: 'POST' })
}

export async function searchEmbeddedModels(payload: {
  query: string
  model: string
  category?: string | null
  limit?: number
}): Promise<{ ok: boolean; model: string; matches: EmbedSearchMatch[] }> {
  return embedRequest('/api/rag/embed/search', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function setAutoEmbedEnabled(
  enabled: boolean,
): Promise<{ ok: boolean; autoEmbedEnabled: boolean; state: EmbedJobState }> {
  return embedRequest('/api/rag/embed/auto', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  })
}
