import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Request, Response } from 'express'
import {
  NVIDIA_API_KEY,
  OPENROUTER_API_KEY,
  OPENROUTER_APP_TITLE,
  OPENROUTER_EMBEDDING_MODEL,
  OPENROUTER_HTTP_REFERER,
  RAG_EMBED_MAX_PER_RUN,
  RAG_EMBEDDING_DIMS,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
  isR2VectorConfigured,
} from './config.js'
import { getR2VectorObjectBuffer, listR2VectorStoragePaths } from './r2.js'
import { getModelRateCaps, modelLabelRateLimiter } from './ragRateLimit.js'
import {
  asJsonObject,
  isRagCategory,
  pruneTagList,
  reconcileTaxonomy,
  sanitizeEmbeddingTextForRag,
} from './ragLabelNormalize.js'
import { hybridRerankMatches, normalizeSearchQuery } from './ragSearchRank.js'

export interface EmbedModelOption {
  id: string
  label: string
  hint?: string
  provider: 'openrouter' | 'nvidia'
  promptPerMillion?: number
  priceLabel?: string
  /** Native/default output size if known; we still request RAG_EMBEDDING_DIMS when possible. */
  nativeDims?: number
}

type JobStatus = 'idle' | 'running' | 'cancelling' | 'completed' | 'failed'

interface EmbedLogLine {
  at: string
  level: 'info' | 'warn' | 'error'
  message: string
}

interface EmbedJobState {
  status: JobStatus
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
  logs: EmbedLogLine[]
  cancelRequested: boolean
}

/** Suggested 1536-capable models (UI examples only — any OpenRouter embed id can be pasted). */
const EMBED_MODELS_1536: EmbedModelOption[] = [
  {
    id: 'openai/text-embedding-3-small',
    label: 'OpenAI text-embedding-3-small',
    hint: 'Default · native 1536 · cheap',
    provider: 'openrouter',
    promptPerMillion: 0.02,
    priceLabel: '$0.02 / 1M',
    nativeDims: 1536,
  },
  {
    id: 'openai/text-embedding-3-large',
    label: 'OpenAI text-embedding-3-large',
    hint: 'Higher quality · request dimensions=1536',
    provider: 'openrouter',
    promptPerMillion: 0.13,
    priceLabel: '$0.13 / 1M',
    nativeDims: 3072,
  },
  {
    id: 'openai/text-embedding-ada-002',
    label: 'OpenAI text-embedding-ada-002',
    hint: 'Legacy · native 1536',
    provider: 'openrouter',
    promptPerMillion: 0.1,
    priceLabel: '$0.10 / 1M',
    nativeDims: 1536,
  },
  {
    id: 'google/gemini-embedding-001',
    label: 'Google gemini-embedding-001',
    hint: 'Supports output dims including 1536',
    provider: 'openrouter',
    promptPerMillion: 0.15,
    priceLabel: '$0.15 / 1M',
    nativeDims: 1536,
  },
  {
    id: 'google/gemini-embedding-2',
    label: 'Google gemini-embedding-2',
    hint: 'Request dimensions=1536',
    provider: 'openrouter',
    promptPerMillion: 0.2,
    priceLabel: '$0.20 / 1M',
    nativeDims: 1536,
  },
  {
    id: 'qwen/qwen3-embedding-8b',
    label: 'Qwen3 Embedding 8B',
    hint: 'Matryoshka · request dimensions=1536',
    provider: 'openrouter',
    promptPerMillion: 0.01,
    priceLabel: '$0.01 / 1M',
    nativeDims: 1536,
  },
  {
    id: 'qwen/qwen3-embedding-4b',
    label: 'Qwen3 Embedding 4B',
    hint: 'Matryoshka · request dimensions=1536',
    provider: 'openrouter',
    promptPerMillion: 0.02,
    priceLabel: '$0.02 / 1M',
    nativeDims: 1536,
  },
]

const PREFERRED_EMBED_MODELS: EmbedModelOption[] = [...EMBED_MODELS_1536]

const job: EmbedJobState = {
  status: 'idle',
  selectedModel: OPENROUTER_EMBEDDING_MODEL,
  force: false,
  limit: 50,
  total: 0,
  completed: 0,
  skipped: 0,
  failed: 0,
  currentFolder: null,
  lastError: null,
  startedAt: null,
  finishedAt: null,
  logs: [],
  cancelRequested: false,
}

let cachedEmbedModels: EmbedModelOption[] = [...PREFERRED_EMBED_MODELS]
let cachedEmbedModelsAt = 0

function pushLog(level: EmbedLogLine['level'], message: string) {
  job.logs.unshift({ at: new Date().toISOString(), level, message })
  if (job.logs.length > 200) job.logs.length = 200
}

function getServiceSupabase(): SupabaseClient {
  if (!SUPABASE_URL?.trim()) throw new Error('SUPABASE_URL is not configured')
  if (!SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function openRouterHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'HTTP-Referer': OPENROUTER_HTTP_REFERER,
    'X-Title': OPENROUTER_APP_TITLE,
  }
}

async function refreshEmbedModelsFromOpenRouter(): Promise<EmbedModelOption[]> {
  if (Date.now() - cachedEmbedModelsAt < 10 * 60_000 && cachedEmbedModels.length > 0) {
    return cachedEmbedModels
  }

  const byId = new Map<string, EmbedModelOption>()
  for (const pref of EMBED_MODELS_1536) byId.set(pref.id, { ...pref })

  if (OPENROUTER_API_KEY?.trim()) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/embeddings/models', {
        headers: openRouterHeaders(),
      })
      if (!response.ok) throw new Error(`OpenRouter models HTTP ${response.status}`)
      const payload = (await response.json()) as {
        data?: Array<{
          id?: string
          name?: string
          pricing?: { prompt?: string }
        }>
      }

      for (const item of payload.data ?? []) {
        if (!item.id) continue
        const prompt = item.pricing?.prompt != null ? Number(item.pricing.prompt) : NaN
        const promptPerMillion = Number.isFinite(prompt) ? prompt * 1_000_000 : undefined
        const existing = byId.get(item.id)
        byId.set(item.id, {
          id: item.id,
          label: existing?.label ?? item.name ?? item.id,
          hint: existing?.hint ?? 'OpenRouter embedding model',
          provider: existing?.provider ?? 'openrouter',
          promptPerMillion: promptPerMillion ?? existing?.promptPerMillion,
          priceLabel:
            promptPerMillion == null
              ? existing?.priceLabel
              : promptPerMillion === 0
                ? 'Free'
                : `$${promptPerMillion.toFixed(4)} / 1M`,
          nativeDims: existing?.nativeDims,
        })
      }
    } catch (error) {
      pushLog(
        'warn',
        `Could not refresh OpenRouter embedding models: ${formatUnknownError(error)}`,
      )
    }
  }

  const preferredIds = new Set(EMBED_MODELS_1536.map((m) => m.id))
  const preferred = EMBED_MODELS_1536.map((m) => byId.get(m.id)!).filter(Boolean)
  const rest = [...byId.values()]
    .filter((m) => !preferredIds.has(m.id))
    .sort((a, b) => a.id.localeCompare(b.id))

  cachedEmbedModels = [...preferred, ...rest]
  cachedEmbedModelsAt = Date.now()
  return cachedEmbedModels
}

function providerForEmbedModel(modelId: string): 'openrouter' | 'nvidia' {
  return (
    cachedEmbedModels.find((m) => m.id === modelId)?.provider ??
    PREFERRED_EMBED_MODELS.find((m) => m.id === modelId)?.provider ??
    (modelId.startsWith('nvidia/nv-') || modelId.includes('nv-embed') ? 'nvidia' : 'openrouter')
  )
}

function estimateEmbedTokens(text: string): number {
  return Math.max(16, Math.ceil(text.length / 4) + 8)
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const record = error as {
      message?: unknown
      details?: unknown
      hint?: unknown
      code?: unknown
      error?: unknown
    }
    const parts = [
      record.message,
      record.details,
      record.hint,
      record.code ? `code=${record.code}` : null,
      typeof record.error === 'string' ? record.error : null,
    ]
      .map((part) => (part == null ? '' : String(part).trim()))
      .filter(Boolean)
    if (parts.length > 0) return parts.join(' | ')
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

async function embedTextOpenRouter(
  text: string,
  modelId: string,
  dims = RAG_EMBEDDING_DIMS,
): Promise<number[]> {
  if (!OPENROUTER_API_KEY?.trim()) throw new Error('OPENROUTER_API_KEY is not configured')
  const cleaned = text.trim()
  if (!cleaned) throw new Error('embedding_text is empty')

  const estimatedTokens = estimateEmbedTokens(cleaned)
  return modelLabelRateLimiter.schedule(modelId, estimatedTokens, async () => {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: openRouterHeaders(),
      body: JSON.stringify({
        model: modelId,
        input: cleaned,
        dimensions: dims,
        encoding_format: 'float',
      }),
    })

    const payload = (await response.json()) as {
      error?: { message?: string }
      data?: Array<{ embedding?: number[] }>
      model?: string
    }

    if (!response.ok) {
      throw new Error(
        formatUnknownError(payload.error) || `OpenRouter embeddings failed (${response.status})`,
      )
    }

    const embedding = payload.data?.[0]?.embedding
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('OpenRouter returned an empty embedding')
    }
    if (embedding.length !== dims) {
      throw new Error(
        `Model returned ${embedding.length} dims but rag_models expects ${dims}. Use openai/text-embedding-3-small (native 1536).`,
      )
    }
    return embedding
  })
}

async function embedTextNvidia(
  text: string,
  modelId: string,
  dims = RAG_EMBEDDING_DIMS,
  inputType: 'passage' | 'query' = 'passage',
): Promise<number[]> {
  if (!NVIDIA_API_KEY?.trim()) throw new Error('NVIDIA_API_KEY is not configured')
  const cleaned = text.trim()
  if (!cleaned) throw new Error('embedding_text is empty')

  const estimatedTokens = estimateEmbedTokens(cleaned)
  return modelLabelRateLimiter.schedule(modelId, estimatedTokens, async () => {
    const response = await fetch('https://integrate.api.nvidia.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        input: cleaned,
        input_type: inputType,
        encoding_format: 'float',
        truncate: 'END',
      }),
    })

    const payload = (await response.json()) as {
      error?: { message?: string } | string
      data?: Array<{ embedding?: number[] }>
    }

    if (!response.ok) {
      throw new Error(
        formatUnknownError(payload.error) || `NVIDIA embeddings failed (${response.status})`,
      )
    }

    const embedding = payload.data?.[0]?.embedding
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('NVIDIA returned an empty embedding')
    }
    if (embedding.length !== dims) {
      throw new Error(
        `NVIDIA model returned ${embedding.length} dims but rag_models expects ${dims}. NIM embed models are often 1024/2048 — keep using openai/text-embedding-3-small for this table, or change the SQL vector size.`,
      )
    }
    return embedding
  })
}

export async function embedText(
  text: string,
  modelId: string,
  options?: { inputType?: 'passage' | 'query' },
): Promise<number[]> {
  if (providerForEmbedModel(modelId) === 'nvidia') {
    return embedTextNvidia(text, modelId, RAG_EMBEDDING_DIMS, options?.inputType ?? 'passage')
  }
  return embedTextOpenRouter(text, modelId, RAG_EMBEDDING_DIMS)
}

function folderKeysFromPaths(paths: string[]): string[] {
  const folders = new Set<string>()
  for (const path of paths) {
    if (!path.endsWith('/label.json') && !path.endsWith('label.json')) continue
    // Prefer ".../label.json" under a folder
    if (path === 'label.json') continue
    if (path.endsWith('/label.json')) {
      folders.add(path.slice(0, -'label.json'.length))
    }
  }
  return [...folders].sort()
}

async function listVectorPackFolders(): Promise<string[]> {
  const paths = await listR2VectorStoragePaths('', 100_000)
  return folderKeysFromPaths(paths)
}

async function readLabelJson(folderKey: string): Promise<Record<string, unknown>> {
  const buf = await getR2VectorObjectBuffer(`${folderKey}label.json`)
  if (!buf) throw new Error('label.json missing')
  const parsed = JSON.parse(buf.toString('utf8')) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('label.json is not an object')
  }
  return parsed as Record<string, unknown>
}

async function alreadyIndexed(
  supabase: SupabaseClient,
  folderKey: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('rag_models')
    .select('id, embedding')
    .eq('r2_folder_key', folderKey)
    .maybeSingle()
  if (error) throw error
  // Skip whenever this pack already has any embedding (unless force).
  return Boolean(data?.embedding)
}

/** All folder keys that already have an embedding row. */
async function listIndexedFolderKeys(supabase: SupabaseClient): Promise<Set<string>> {
  const keys = new Set<string>()
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('rag_models')
      .select('r2_folder_key, embedding')
      .not('embedding', 'is', null)
      .range(from, from + pageSize - 1)
    if (error) throw error
    if (!data?.length) break
    for (const row of data) {
      if (row.r2_folder_key) keys.add(String(row.r2_folder_key))
    }
    if (data.length < pageSize) break
  }
  return keys
}

/**
 * Limit means "process this many packs this run", not "first N folders in R2".
 * Without force: take the next N not-yet-embedded packs.
 * With force: take the first N packs (re-embed / overwrite).
 */
async function selectFoldersForEmbedJob(
  allFolders: string[],
  limit: number,
  force: boolean,
): Promise<{ folders: string[]; skippedAlready: number; pendingAvailable: number }> {
  if (force) {
    return {
      folders: allFolders.slice(0, limit),
      skippedAlready: 0,
      pendingAvailable: allFolders.length,
    }
  }

  const supabase = getServiceSupabase()
  const indexed = await listIndexedFolderKeys(supabase)
  const pending: string[] = []
  let skippedAlready = 0
  for (const folder of allFolders) {
    const key = folder.endsWith('/') ? folder : `${folder}/`
    if (indexed.has(key) || indexed.has(folder)) {
      skippedAlready += 1
      continue
    }
    pending.push(folder)
  }
  return {
    folders: pending.slice(0, limit),
    skippedAlready,
    pendingAvailable: pending.length,
  }
}

async function upsertEmbeddedLabel(
  supabase: SupabaseClient,
  folderKey: string,
  label: Record<string, unknown>,
  embedding: number[],
  modelId: string,
): Promise<void> {
  const prepared = prepareLabelForIndex(label)
  const description = String(prepared.description || '').trim()
  const embeddingText = String(prepared.embedding_text || '').trim()
  if (!description) throw new Error('label.description is empty')
  if (!embeddingText) throw new Error('label.embedding_text is empty')

  // PostgREST/pgvector expects a vector literal string, not a JSON array.
  const embeddingLiteral = `[${embedding.join(',')}]`
  const row = {
    r2_folder_key: folderKey,
    description,
    embedding_text: embeddingText,
    embedding: embeddingLiteral,
    embedding_model: modelId,
    embedding_dims: RAG_EMBEDDING_DIMS,
    category: String(prepared.category || 'prop'),
    subcategory: prepared.subcategory != null ? String(prepared.subcategory) : null,
    style_tags: Array.isArray(prepared.style_tags) ? prepared.style_tags.map(String) : [],
    material_tags: Array.isArray(prepared.material_tags) ? prepared.material_tags.map(String) : [],
    color_palette: Array.isArray(prepared.color_palette) ? prepared.color_palette.map(String) : [],
    complexity: prepared.complexity != null ? String(prepared.complexity) : null,
    cube_count: typeof prepared.cube_count === 'number' ? prepared.cube_count : null,
    has_animation: Boolean(prepared.has_animation),
    has_metadata: Boolean(prepared.has_metadata),
    confidence: prepared.confidence != null ? String(prepared.confidence) : null,
    needs_review: Boolean(prepared.needs_review),
    label_schema_version:
      typeof prepared.label_schema_version === 'number' ? prepared.label_schema_version : null,
    // Plain object → real jsonb (unwraps accidental double-stringified payloads).
    raw_label: prepared,
  }

  const { error } = await supabase.from('rag_models').upsert(row, { onConflict: 'r2_folder_key' })
  if (error) throw error
}

/** Normalize category / embedding_text / tags before vectorizing so stored text matches the vector. */
function prepareLabelForIndex(
  label: Record<string, unknown>,
  folderHint?: string | null,
): Record<string, unknown> {
  const raw = asJsonObject(label)
  const categoryRaw = String(raw.category || 'prop')
    .trim()
    .toLowerCase()
  const reconciled = reconcileTaxonomy({
    category: categoryRaw,
    subcategory:
      raw.subcategory != null && String(raw.subcategory).trim()
        ? String(raw.subcategory).trim().toLowerCase().replace(/\s+/g, '-')
        : null,
    folderHint:
      folderHint ||
      (raw._source_folder != null ? String(raw._source_folder) : null) ||
      (raw.model_name != null ? String(raw.model_name) : null),
  })
  const hasAnimation = Boolean(raw.has_animation)
  const embeddingText = sanitizeEmbeddingTextForRag(
    String(raw.embedding_text || '').trim(),
    hasAnimation,
    reconciled.category,
    reconciled.subcategory,
    folderHint ||
      (raw._source_folder != null ? String(raw._source_folder) : null) ||
      (raw.model_name != null ? String(raw.model_name) : null),
  )
  return {
    ...raw,
    category: reconciled.category,
    subcategory: reconciled.subcategory,
    embedding_text: embeddingText,
    style_tags: pruneTagList(raw.style_tags, 12),
    material_tags: pruneTagList(raw.material_tags, 8),
    needs_review:
      Boolean(raw.needs_review) || !isRagCategory(categoryRaw) || reconciled.needsReview,
    ...(reconciled.coerced
      ? {
          _taxonomy_reconciled: true,
          _category_coerced_from: categoryRaw,
          _subcategory_coerced_from:
            raw.subcategory != null ? String(raw.subcategory) : null,
        }
      : {}),
  }
}

/**
 * Index one vector-db folder into rag_models (used after label/upload and by batch jobs).
 * Safe to call fire-and-forget. Skips when already embedded unless force=true.
 */
export async function indexVectorFolderToRag(
  folderName: string,
  options?: { force?: boolean; model?: string },
): Promise<{ status: 'indexed' | 'skipped'; folder: string; reason?: string }> {
  const folderKey = folderName.endsWith('/') ? folderName : `${folderName}/`
  const modelId = (options?.model?.trim() || OPENROUTER_EMBEDDING_MODEL).trim()
  const force = Boolean(options?.force)

  if (!SUPABASE_SERVICE_ROLE_KEY?.trim() || !SUPABASE_URL?.trim()) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  }
  if (providerForEmbedModel(modelId) === 'nvidia' && !NVIDIA_API_KEY?.trim()) {
    throw new Error('NVIDIA_API_KEY is not configured')
  }
  if (providerForEmbedModel(modelId) !== 'nvidia' && !OPENROUTER_API_KEY?.trim()) {
    throw new Error('OPENROUTER_API_KEY is not configured')
  }

  const supabase = getServiceSupabase()
  if (!force && (await alreadyIndexed(supabase, folderKey))) {
    return { status: 'skipped', folder: folderKey, reason: 'already embedded' }
  }

  const label = prepareLabelForIndex(await readLabelJson(folderKey), folderKey)
  const embeddingText = String(label.embedding_text || '').trim()
  if (!embeddingText) throw new Error(`embedding_text missing for ${folderKey}`)

  // Skip low-quality labels from automatic indexing (manual Force embed can still include them).
  if (!force && (label.needs_review === true || String(label.confidence || '') === 'low')) {
    return {
      status: 'skipped',
      folder: folderKey,
      reason: 'needs_review or low confidence',
    }
  }

  const embedding = await embedText(embeddingText, modelId, { inputType: 'passage' })
  await upsertEmbeddedLabel(supabase, folderKey, label, embedding, modelId)
  return { status: 'indexed', folder: folderKey }
}

const AUTO_EMBED_SETTINGS_PATH = () => join(process.cwd(), 'logs', 'rag-auto-embed.json')

function readAutoEmbedEnabled(): boolean {
  try {
    if (!existsSync(AUTO_EMBED_SETTINGS_PATH())) return true
    const raw = JSON.parse(readFileSync(AUTO_EMBED_SETTINGS_PATH(), 'utf8')) as {
      enabled?: boolean
    }
    return raw.enabled !== false
  } catch {
    return true
  }
}

function writeAutoEmbedEnabled(enabled: boolean): void {
  const dir = join(process.cwd(), 'logs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(
    AUTO_EMBED_SETTINGS_PATH(),
    `${JSON.stringify({ enabled, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  )
}

let autoEmbedEnabled = readAutoEmbedEnabled()

export function isAutoEmbedEnabled(): boolean {
  return autoEmbedEnabled
}

export function setAutoEmbedEnabled(enabled: boolean): boolean {
  autoEmbedEnabled = Boolean(enabled)
  writeAutoEmbedEnabled(autoEmbedEnabled)
  pushLog('info', `Auto-embed after labeling: ${autoEmbedEnabled ? 'ON' : 'OFF'}`)
  return autoEmbedEnabled
}

/**
 * Run auto-embed for one folder (respects toggle). Logs to Embed job log.
 */
export async function runAutoIndexVectorFolder(
  folderName: string,
): Promise<{ status: 'indexed' | 'skipped' | 'disabled' | 'failed'; folder: string; reason?: string }> {
  const folderKey = folderName.endsWith('/') ? folderName : `${folderName}/`
  if (!autoEmbedEnabled) {
    pushLog('info', `Auto-embed OFF — skipped ${folderKey}`)
    return { status: 'disabled', folder: folderKey, reason: 'auto-embed disabled' }
  }
  if (!SUPABASE_SERVICE_ROLE_KEY?.trim() || !OPENROUTER_API_KEY?.trim()) {
    pushLog('warn', `Auto-embed unavailable (missing service role or OpenRouter key) — ${folderKey}`)
    return { status: 'failed', folder: folderKey, reason: 'missing API keys' }
  }

  try {
    const result = await indexVectorFolderToRag(folderKey)
    if (result.status === 'indexed') {
      pushLog('info', `Auto-embedded ${result.folder}`)
    } else {
      pushLog(
        'info',
        `Auto-embed skipped ${result.folder}${result.reason ? ` (${result.reason})` : ''}`,
      )
    }
    return result
  } catch (error) {
    const reason = formatUnknownError(error)
    pushLog('warn', `Auto-embed failed ${folderKey}: ${reason}`)
    return { status: 'failed', folder: folderKey, reason }
  }
}

/** Non-blocking auto-index after a successful vector-db write. */
export function scheduleAutoIndexVectorFolder(folderName: string): void {
  void runAutoIndexVectorFolder(folderName)
}

async function countIndexed(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from('rag_models')
    .select('id', { count: 'exact', head: true })
  if (error) throw error
  return count ?? 0
}

function publicState(extra?: Record<string, unknown>) {
  const rate = modelLabelRateLimiter.getStatus(job.selectedModel || OPENROUTER_EMBEDDING_MODEL)
  return {
    ...job,
    embeddingDims: RAG_EMBEDDING_DIMS,
    maxPerRun: RAG_EMBED_MAX_PER_RUN,
    autoEmbedEnabled,
    availableModels: cachedEmbedModels.map((option) => {
      const ready =
        option.provider === 'nvidia'
          ? Boolean(NVIDIA_API_KEY?.trim())
          : Boolean(OPENROUTER_API_KEY?.trim())
      return { ...option, configured: ready }
    }),
    rateLimit: {
      rpmLimit: rate.rpmLimit,
      tpmLimit: rate.tpmLimit,
      rpdLimit: rate.rpdLimit,
      rpmUsed: rate.rpmUsed,
      tpmUsed: rate.tpmUsed,
      rpdUsed: rate.rpdUsed,
      rpmRemaining: rate.rpmRemaining,
      tpmRemaining: rate.tpmRemaining,
      rpdRemaining: rate.rpdRemaining,
      nextSlotSeconds: rate.nextSlotSeconds,
      canSendNow: rate.canSendNow,
    },
    providers: {
      openrouter: Boolean(OPENROUTER_API_KEY?.trim()),
      nvidia: Boolean(NVIDIA_API_KEY?.trim()),
      supabaseService: Boolean(SUPABASE_SERVICE_ROLE_KEY?.trim()),
      vectorBucket: isR2VectorConfigured(),
    },
    configured:
      (Boolean(OPENROUTER_API_KEY?.trim()) || Boolean(NVIDIA_API_KEY?.trim())) &&
      Boolean(SUPABASE_SERVICE_ROLE_KEY?.trim()) &&
      isR2VectorConfigured(),
    ...extra,
  }
}

async function runEmbedJob(folders: string[], modelId: string, force: boolean) {
  const supabase = getServiceSupabase()
  job.status = 'running'
  job.startedAt = new Date().toISOString()
  job.finishedAt = null
  job.lastError = null
  job.total = folders.length
  job.completed = 0
  job.skipped = 0
  job.failed = 0
  job.cancelRequested = false
  pushLog('info', `Embedding ${folders.length} pack(s) with ${modelId} @ ${RAG_EMBEDDING_DIMS} dims`)

  try {
    for (const folder of folders) {
      if (job.cancelRequested) {
        job.status = 'cancelling'
        pushLog('warn', 'Cancel requested — stopping after current item')
        break
      }

      job.currentFolder = folder
      try {
        if (!force && (await alreadyIndexed(supabase, folder))) {
          job.skipped += 1
          pushLog('info', `Skipped (already embedded): ${folder}`)
          continue
        }

        const label = prepareLabelForIndex(await readLabelJson(folder), folder)
        const embeddingText = String(label.embedding_text || '').trim()
        if (!embeddingText) throw new Error('embedding_text missing in label.json')

        const embedding = await embedText(embeddingText, modelId, { inputType: 'passage' })
        await upsertEmbeddedLabel(supabase, folder, label, embedding, modelId)
        job.completed += 1
        pushLog('info', `Indexed ${folder}`)
      } catch (error) {
        job.failed += 1
        const message = formatUnknownError(error)
        job.lastError = `${folder}: ${message}`
        pushLog('error', `Failed ${folder}: ${message}`)
      }
    }

    job.status = job.cancelRequested ? 'completed' : job.failed > 0 && job.completed === 0 ? 'failed' : 'completed'
    job.finishedAt = new Date().toISOString()
    job.currentFolder = null
    pushLog(
      'info',
      `Done. embedded=${job.completed} skipped=${job.skipped} failed=${job.failed}`,
    )
  } catch (error) {
    job.status = 'failed'
    job.finishedAt = new Date().toISOString()
    job.currentFolder = null
    job.lastError = formatUnknownError(error)
    pushLog('error', job.lastError)
  }
}

export async function ragEmbedStatusHandler(req: Request, res: Response) {
  try {
    await refreshEmbedModelsFromOpenRouter()
    let indexedCount: number | null = null
    let packCount: number | null = null
    try {
      if (isR2VectorConfigured()) {
        packCount = (await listVectorPackFolders()).length
      }
    } catch {
      packCount = null
    }
    try {
      if (SUPABASE_SERVICE_ROLE_KEY?.trim() && SUPABASE_URL?.trim()) {
        indexedCount = await countIndexed(getServiceSupabase())
      }
    } catch {
      indexedCount = null
    }

    const requested = typeof req.query.model === 'string' ? req.query.model.trim() : ''
    if (requested) job.selectedModel = requested

    res.json(
      publicState({
        packCount,
        indexedCount,
        selectedModel: job.selectedModel || OPENROUTER_EMBEDDING_MODEL,
      }),
    )
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load embed status',
    })
  }
}

export async function ragEmbedStartHandler(req: Request, res: Response) {
  try {
    if (job.status === 'running' || job.status === 'cancelling') {
      res.status(409).json({ error: 'An embedding job is already running' })
      return
    }
    if (!OPENROUTER_API_KEY?.trim() && !NVIDIA_API_KEY?.trim()) {
      res.status(400).json({ error: 'OPENROUTER_API_KEY or NVIDIA_API_KEY is not configured' })
      return
    }
    if (!SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      res.status(400).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured' })
      return
    }
    if (!isR2VectorConfigured()) {
      res.status(400).json({ error: 'R2 vector-db bucket is not configured' })
      return
    }

    await refreshEmbedModelsFromOpenRouter()

    const body = (req.body ?? {}) as {
      model?: string
      limit?: number
      force?: boolean
      folders?: string[]
    }

    const modelId = (body.model?.trim() || job.selectedModel || OPENROUTER_EMBEDDING_MODEL).trim()
    const provider = providerForEmbedModel(modelId)
    if (provider === 'nvidia' && !NVIDIA_API_KEY?.trim()) {
      res.status(400).json({ error: 'NVIDIA_API_KEY is not configured for this embedding model' })
      return
    }
    if (provider === 'openrouter' && !OPENROUTER_API_KEY?.trim()) {
      res.status(400).json({ error: 'OPENROUTER_API_KEY is not configured for this embedding model' })
      return
    }

    const force = Boolean(body.force)
    const limitRaw = Number(body.limit ?? 50)
    const rate = modelLabelRateLimiter.getStatus(modelId)
    const caps = getModelRateCaps(modelId)
    const safeByQuota = Math.max(0, Math.min(rate.rpdRemaining, rate.rpmLimit * 10))
    const limit = Math.max(
      1,
      Math.min(
        Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 50,
        RAG_EMBED_MAX_PER_RUN,
        Math.max(1, safeByQuota || RAG_EMBED_MAX_PER_RUN),
      ),
    )

    if (rate.rpdRemaining <= 0) {
      res.status(429).json({
        error: `Daily embed safety limit reached for ${modelId} (${caps.rpd} RPD). Try again tomorrow (UTC) or pick another model.`,
      })
      return
    }

    if (Number.isFinite(limitRaw) && Math.floor(limitRaw) > limit) {
      pushLog(
        'warn',
        `Limit clamped from ${Math.floor(limitRaw)} → ${limit} by safety caps (maxPerRun=${RAG_EMBED_MAX_PER_RUN}, rpdRemaining=${rate.rpdRemaining}, rpm=${caps.rpm})`,
      )
    }

    let folders =
      Array.isArray(body.folders) && body.folders.length > 0
        ? body.folders.map(String)
        : await listVectorPackFolders()

    const selected = await selectFoldersForEmbedJob(folders, limit, force)
    folders = selected.folders
    if (folders.length === 0) {
      res.status(400).json({
        error: force
          ? 'No vector-db packs with label.json found'
          : selected.skippedAlready > 0
            ? `Nothing left to embed — ${selected.skippedAlready} pack(s) already indexed. Turn on Force re-embed to overwrite.`
            : 'No vector-db packs with label.json found',
      })
      return
    }

    job.selectedModel = modelId
    job.force = force
    job.limit = limit
    job.logs = []

    if (!force && selected.skippedAlready > 0) {
      pushLog(
        'info',
        `Skipping ${selected.skippedAlready} already-embedded pack(s); queueing next ${folders.length} of ${selected.pendingAvailable} pending`,
      )
    }

    void runEmbedJob(folders, modelId, force)
    res.json({ ok: true, state: publicState() })
  } catch (error) {
    res.status(500).json({
      error: formatUnknownError(error) || 'Failed to start embedding job',
    })
  }
}

export async function ragEmbedCancelHandler(_req: Request, res: Response) {
  if (job.status !== 'running') {
    res.json({ ok: true, state: publicState() })
    return
  }
  job.cancelRequested = true
  job.status = 'cancelling'
  pushLog('warn', 'Cancel requested')
  res.json({ ok: true, state: publicState() })
}

export async function ragEmbedSearchHandler(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as {
      query?: string
      model?: string
      category?: string | null
      subcategory?: string | null
      limit?: number
      minSimilarity?: number
    }
    const query = body.query?.trim()
    if (!query) {
      res.status(400).json({ error: 'query is required' })
      return
    }
    const searchQuery = normalizeSearchQuery(query)
    if (!searchQuery) {
      res.status(400).json({ error: 'query is required' })
      return
    }
    const modelId = (body.model?.trim() || job.selectedModel || OPENROUTER_EMBEDDING_MODEL).trim()
    const matchCount = Math.max(1, Math.min(Number(body.limit) || 5, 20))
    // Slightly stricter default → cleaner neighbors for generation later.
    const minSimilarity = Number.isFinite(Number(body.minSimilarity))
      ? Number(body.minSimilarity)
      : 0.22

    // Match document-side tokenization (spaces, no hyphens) before embedding the query.
    const embedding = await embedText(searchQuery, modelId, { inputType: 'query' })
    const supabase = getServiceSupabase()

    const rpcArgs = {
      query_embedding: `[${embedding.join(',')}]`,
      // Pull a wider candidate pool, then hybrid-rerank down to matchCount.
      match_count: Math.min(Math.max(matchCount * 4, 12), 24),
      filter_category: body.category ?? null,
      filter_subcategory: body.subcategory ?? null,
      filter_embedding_model: modelId,
      min_similarity: minSimilarity,
      exclude_needs_review: true,
      exclude_low_confidence: true,
    }

    let { data, error } = await supabase.rpc('match_rag_models', rpcArgs)
    // Backward compatible if the SQL function hasn't been upgraded yet.
    if (
      error &&
      /exclude_needs_review|exclude_low_confidence|Could not find the function/i.test(error.message)
    ) {
      ;({ data, error } = await supabase.rpc('match_rag_models', {
        query_embedding: rpcArgs.query_embedding,
        match_count: rpcArgs.match_count,
        filter_category: rpcArgs.filter_category,
        filter_subcategory: rpcArgs.filter_subcategory,
        filter_embedding_model: rpcArgs.filter_embedding_model,
        min_similarity: rpcArgs.min_similarity,
      }))
    }
    if (error) throw error

    const ranked = hybridRerankMatches(searchQuery, (data ?? []) as Array<{
      id: string
      r2_folder_key: string
      description: string
      category: string
      subcategory: string | null
      has_animation: boolean
      has_metadata: boolean
      embedding_model: string | null
      confidence?: string | null
      similarity: number
    }>)

    res.json({ ok: true, model: modelId, matches: ranked.slice(0, matchCount) })
  } catch (error) {
    res.status(500).json({
      error: formatUnknownError(error),
    })
  }
}

export async function ragEmbedAutoToggleHandler(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as { enabled?: boolean }
    if (typeof body.enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled (boolean) is required' })
      return
    }
    const enabled = setAutoEmbedEnabled(body.enabled)
    res.json({ ok: true, autoEmbedEnabled: enabled, state: publicState() })
  } catch (error) {
    res.status(500).json({ error: formatUnknownError(error) })
  }
}
