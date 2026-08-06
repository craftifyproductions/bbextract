import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Request, Response } from 'express'
import {
  NVIDIA_API_KEY,
  OPENROUTER_API_KEY,
  OPENROUTER_APP_TITLE,
  OPENROUTER_HTTP_REFERER,
  OPENROUTER_LABEL_MODEL,
  RAG_BATCH_MAX_PER_RUN,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  isR2Configured,
  isR2VectorConfigured,
} from './config.js'
import {
  getR2ObjectBuffer,
  listR2StoragePaths,
  listR2VectorStoragePaths,
  syncModelToVectorBucket,
  vectorFolderFromModelRoot,
} from './r2.js'

/** Bump when label fields/prompt change enough to warrant re-labeling. */
export const LABEL_SCHEMA_VERSION = 3
import {
  estimateLabelTokens,
  getModelRateCaps,
  modelLabelRateLimiter,
  type LabelProvider,
} from './ragRateLimit.js'
import { isAutoEmbedEnabled, runAutoIndexVectorFolder } from './ragEmbed.js'
import {
  isRagCategory,
  pruneTagList,
  reconcileTaxonomy,
  sanitizeEmbeddingTextForRag,
} from './ragLabelNormalize.js'

const FILE_KINDS = new Set([
  'model_zip',
  'metadata',
  'summary',
  'raw_model',
  'geometry',
  'texture',
  'animation',
  'json',
  'element',
])

const COMPLEXITIES = ['simple', 'medium', 'complex'] as const
const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const

function countCubes(elements: unknown[]): number {
  let cubes = 0
  for (const el of elements) {
    if (!el || typeof el !== 'object') continue
    const type = String((el as { type?: string }).type || 'cube').toLowerCase()
    if (type === 'cube' || type === '') cubes += 1
  }
  return cubes
}

/** Deterministic complexity from cube/element counts (prefer over LLM guess). */
function complexityFromCounts(cubeCount: number, elementCount: number): (typeof COMPLEXITIES)[number] {
  const n = cubeCount > 0 ? cubeCount : elementCount
  if (n <= 24) return 'simple'
  if (n <= 100) return 'medium'
  return 'complex'
}

export interface RagLabelModelOption {
  id: string
  label: string
  hint: string
  provider: LabelProvider
}

/** Top OpenRouter vision models for RAG Label UI dropdown. */
export const RAG_LABEL_MODELS: RagLabelModelOption[] = [
  {
    id: 'xiaomi/mimo-v2.5',
    label: 'MiMo V2.5',
    hint: 'OpenRouter · top vision usage · strong multimodal',
    provider: 'openrouter',
  },
  {
    id: 'minimax/minimax-m3',
    label: 'MiniMax M3',
    hint: 'OpenRouter · frontier multimodal · long context',
    provider: 'openrouter',
  },
  {
    id: 'stepfun/step-3.7-flash',
    label: 'Step 3.7 Flash',
    hint: 'OpenRouter · fast efficient vision',
    provider: 'openrouter',
  },
  {
    id: 'google/gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    hint: 'OpenRouter · Google · latest Flash vision',
    provider: 'openrouter',
  },
  {
    id: 'google/gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    hint: 'OpenRouter · Google · default · strong vision',
    provider: 'openrouter',
  },
  {
    id: 'google/gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    hint: 'OpenRouter · Google · higher quality vision',
    provider: 'openrouter',
  },
  {
    id: 'anthropic/claude-sonnet-5',
    label: 'Claude Sonnet 5',
    hint: 'OpenRouter · Anthropic · excellent vision reasoning',
    provider: 'openrouter',
  },
  {
    id: 'anthropic/claude-sonnet-4.6',
    label: 'Claude Sonnet 4.6',
    hint: 'OpenRouter · Anthropic · proven vision quality',
    provider: 'openrouter',
  },
  {
    id: 'openai/gpt-5.4',
    label: 'GPT-5.4',
    hint: 'OpenRouter · OpenAI · frontier vision',
    provider: 'openrouter',
  },
  {
    id: 'openai/gpt-4.1',
    label: 'GPT-4.1',
    hint: 'OpenRouter · OpenAI · strong vision',
    provider: 'openrouter',
  },
  {
    id: 'openai/gpt-4.1-mini',
    label: 'GPT-4.1 Mini',
    hint: 'OpenRouter · OpenAI · cheap / fast vision',
    provider: 'openrouter',
  },
  {
    id: 'openai/gpt-4o',
    label: 'GPT-4o',
    hint: 'OpenRouter · OpenAI · classic multimodal',
    provider: 'openrouter',
  },
  {
    id: 'qwen/qwen3-vl-235b-a22b-instruct',
    label: 'Qwen3 VL 235B',
    hint: 'OpenRouter · Qwen · large vision model',
    provider: 'openrouter',
  },
  {
    id: 'qwen/qwen2.5-vl-72b-instruct',
    label: 'Qwen2.5 VL 72B',
    hint: 'OpenRouter · Qwen · strong VLM',
    provider: 'openrouter',
  },
  {
    id: 'meta-llama/llama-4-maverick',
    label: 'Llama 4 Maverick',
    hint: 'OpenRouter · Meta · multimodal',
    provider: 'openrouter',
  },
  {
    id: 'meta-llama/llama-4-scout',
    label: 'Llama 4 Scout',
    hint: 'OpenRouter · Meta · fast multimodal',
    provider: 'openrouter',
  },
  {
    id: 'nvidia/nemotron-nano-12b-v2-vl',
    label: 'Nemotron Nano 12B VL',
    hint: 'NVIDIA NIM · direct API · fast vision',
    provider: 'nvidia',
  },
  {
    id: 'nvidia/llama-3.1-nemotron-nano-vl-8b-v1',
    label: 'Nemotron Nano VL 8B',
    hint: 'NVIDIA NIM · direct API · smaller/faster',
    provider: 'nvidia',
  },
  {
    id: 'meta/llama-4-scout-17b-16e-instruct',
    label: 'Llama 4 Scout (NIM)',
    hint: 'NVIDIA NIM · direct API · multimodal',
    provider: 'nvidia',
  },
  {
    id: 'google/gemma-3-27b-it',
    label: 'Gemma 3 27B (NIM)',
    hint: 'NVIDIA NIM · direct API · image reasoning',
    provider: 'nvidia',
  },
]

export interface OpenRouterUsageInfo {
  keyLabel: string | null
  /** USD spent on this API key (all time / day / week / month). */
  usage: number
  usageDaily: number
  usageWeekly: number
  usageMonthly: number
  /** Optional per-key spending cap (USD). */
  limit: number | null
  limitRemaining: number | null
  limitReset: string | null
  isFreeTier: boolean
  /** Account-level credits. */
  totalCredits: number | null
  totalUsage: number | null
  /** totalCredits - totalUsage when both known. */
  balanceRemaining: number | null
  updatedAt: string
}

let cachedOpenRouterUsage: OpenRouterUsageInfo | null = null
let openRouterUsageFetchedAt = 0

export interface OpenRouterModelPricing {
  /** USD per 1M prompt tokens */
  promptPerMillion: number
  /** USD per 1M completion tokens */
  completionPerMillion: number
  /** Short UI label, e.g. "$1.50 / $9.00" or "Free" */
  priceLabel: string
}

let cachedModelPricing = new Map<string, OpenRouterModelPricing>()
let modelPricingFetchedAt = 0

function formatUsdPerMillion(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0'
  if (value >= 1) return `$${value.toFixed(2)}`
  if (value >= 0.1) return `$${value.toFixed(2)}`
  return `$${value.toFixed(3)}`
}

function buildPriceLabel(promptPerMillion: number, completionPerMillion: number): string {
  if (promptPerMillion <= 0 && completionPerMillion <= 0) return 'Free'
  return `${formatUsdPerMillion(promptPerMillion)} / ${formatUsdPerMillion(completionPerMillion)}`
}

async function fetchOpenRouterModelPricing(force = false): Promise<Map<string, OpenRouterModelPricing>> {
  const now = Date.now()
  if (!force && cachedModelPricing.size > 0 && now - modelPricingFetchedAt < 30 * 60_000) {
    return cachedModelPricing
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return cachedModelPricing

    const payload = (await response.json()) as {
      data?: Array<{ id?: string; pricing?: { prompt?: string; completion?: string } }>
    }
    const next = new Map<string, OpenRouterModelPricing>()
    for (const model of payload.data ?? []) {
      if (!model.id || !RAG_LABEL_MODEL_IDS.has(model.id)) continue
      const promptPerMillion = Number(model.pricing?.prompt ?? 0) * 1_000_000
      const completionPerMillion = Number(model.pricing?.completion ?? 0) * 1_000_000
      next.set(model.id, {
        promptPerMillion: Number.isFinite(promptPerMillion) ? promptPerMillion : 0,
        completionPerMillion: Number.isFinite(completionPerMillion) ? completionPerMillion : 0,
        priceLabel: buildPriceLabel(promptPerMillion, completionPerMillion),
      })
    }
    if (next.size > 0) {
      cachedModelPricing = next
      modelPricingFetchedAt = now
    }
  } catch {
    // Keep previous cache on network failure.
  }
  return cachedModelPricing
}

async function fetchOpenRouterUsage(force = false): Promise<OpenRouterUsageInfo | null> {
  if (!OPENROUTER_API_KEY?.trim()) return null
  const now = Date.now()
  if (!force && cachedOpenRouterUsage && now - openRouterUsageFetchedAt < 45_000) {
    return cachedOpenRouterUsage
  }

  try {
    const headers = {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      Accept: 'application/json',
    }
    const [keyRes, creditsRes] = await Promise.all([
      fetch('https://openrouter.ai/api/v1/key', { headers }),
      fetch('https://openrouter.ai/api/v1/credits', { headers }),
    ])

    const keyPayload = (await keyRes.json().catch(() => null)) as {
      data?: {
        label?: string
        usage?: number
        usage_daily?: number
        usage_weekly?: number
        usage_monthly?: number
        limit?: number | null
        limit_remaining?: number | null
        limit_reset?: string | null
        is_free_tier?: boolean
      }
      error?: { message?: string }
    } | null

    const creditsPayload = (await creditsRes.json().catch(() => null)) as {
      data?: { total_credits?: number; total_usage?: number }
    } | null

    if (!keyRes.ok) {
      pushLog(
        'warn',
        `OpenRouter usage fetch failed: ${keyPayload?.error?.message || keyRes.status}`,
      )
      return cachedOpenRouterUsage
    }

    const key = keyPayload?.data ?? {}
    const credits = creditsPayload?.data ?? {}
    const totalCredits =
      typeof credits.total_credits === 'number' ? credits.total_credits : null
    const totalUsage = typeof credits.total_usage === 'number' ? credits.total_usage : null

    cachedOpenRouterUsage = {
      keyLabel: typeof key.label === 'string' ? key.label : null,
      usage: Number(key.usage ?? 0),
      usageDaily: Number(key.usage_daily ?? 0),
      usageWeekly: Number(key.usage_weekly ?? 0),
      usageMonthly: Number(key.usage_monthly ?? 0),
      limit: typeof key.limit === 'number' ? key.limit : null,
      limitRemaining: typeof key.limit_remaining === 'number' ? key.limit_remaining : null,
      limitReset: typeof key.limit_reset === 'string' ? key.limit_reset : null,
      isFreeTier: Boolean(key.is_free_tier),
      totalCredits,
      totalUsage,
      balanceRemaining:
        totalCredits != null && totalUsage != null
          ? Math.max(0, totalCredits - totalUsage)
          : null,
      updatedAt: new Date().toISOString(),
    }
    openRouterUsageFetchedAt = now
    return cachedOpenRouterUsage
  } catch (error) {
    pushLog(
      'warn',
      `OpenRouter usage fetch error: ${error instanceof Error ? error.message : String(error)}`,
    )
    return cachedOpenRouterUsage
  }
}

const RAG_LABEL_MODEL_IDS = new Set(RAG_LABEL_MODELS.map((model) => model.id))

function getModelOption(modelId: string): RagLabelModelOption | undefined {
  return RAG_LABEL_MODELS.find((model) => model.id === modelId)
}

function providerForModel(modelId: string): LabelProvider {
  return getModelOption(modelId)?.provider ?? 'openrouter'
}

function resolveLabelModel(requested?: string | null): string {
  const cleaned = requested?.trim()
  if (cleaned && RAG_LABEL_MODEL_IDS.has(cleaned)) return cleaned
  if (RAG_LABEL_MODEL_IDS.has(OPENROUTER_LABEL_MODEL)) return OPENROUTER_LABEL_MODEL
  return RAG_LABEL_MODELS[0]?.id ?? 'google/gemini-3.5-flash'
}

function isProviderConfigured(provider: LabelProvider): boolean {
  if (provider === 'nvidia') return Boolean(NVIDIA_API_KEY?.trim())
  return Boolean(OPENROUTER_API_KEY?.trim())
}

function providerKeyError(provider: LabelProvider): string {
  if (provider === 'nvidia') return 'NVIDIA_API_KEY is not configured'
  return 'OPENROUTER_API_KEY is not configured'
}

/** NIM model ids never use OpenRouter's `:free` suffix. */
function nvidiaApiModelId(modelId: string): string {
  return modelId.replace(/:free$/i, '')
}

type JobStatus = 'idle' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled'

interface ModelJob {
  root: string
  modelName: string
  runId: string
  hasModelJson: boolean
  hasLabelJson: boolean
  hasGeometry: boolean
  hasMetadata: boolean
  hasRawModel: boolean
  hasAssets: boolean
  /** Canonical corpus folder name in vector-db. */
  vectorFolder: string
  /** Present in vector-db with current schema — skip labeling. */
  vectorComplete: boolean
}

interface VectorPackStatus {
  hasModel: boolean
  hasLabel: boolean
  schemaVersion: number | null
}

interface JobLog {
  at: string
  level: 'info' | 'warn' | 'error'
  message: string
}

interface BatchJobState {
  id: string | null
  status: JobStatus
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
  logs: JobLog[]
  results: Array<{
    root: string
    status: 'done' | 'skipped' | 'failed'
    reason?: string
  }>
}

interface StartBody {
  limit?: number
  dryRun?: boolean
  model?: string
}

const job: BatchJobState = {
  id: null,
  status: 'idle',
  startedAt: null,
  finishedAt: null,
  force: false,
  dryRun: false,
  limit: 0,
  total: 0,
  completed: 0,
  skipped: 0,
  failed: 0,
  currentModel: null,
  selectedModel: resolveLabelModel(OPENROUTER_LABEL_MODEL),
  lastError: null,
  logs: [],
  results: [],
}

let abortRequested = false
let runner: Promise<void> | null = null

function pushLog(level: JobLog['level'], message: string): void {
  job.logs.push({ at: new Date().toISOString(), level, message })
  if (job.logs.length > 300) job.logs.splice(0, job.logs.length - 300)
  const prefix = level === 'error' ? 'ERROR' : level === 'warn' ? 'WARN' : 'INFO'
  console.log(`[RAG-BATCH] ${prefix}: ${message}`)
}

function modelRootFromPath(storagePath: string): string | null {
  const parts = storagePath.split('/').filter(Boolean)
  for (let i = parts.length - 2; i >= 1; i -= 1) {
    if (FILE_KINDS.has(parts[i]!)) {
      return parts.slice(0, i).join('/')
    }
  }
  return null
}

function parseJsonBuffer(buffer: Buffer | null): unknown {
  if (!buffer) return null
  try {
    return JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

function discoverModels(paths: string[]): ModelJob[] {
  const byRoot = new Map<string, ModelJob>()

  for (const storagePath of paths) {
    const root = modelRootFromPath(storagePath)
    if (!root) continue
    let entry = byRoot.get(root)
    if (!entry) {
      const parts = root.split('/')
      const modelName = parts[parts.length - 1] || root
      entry = {
        root,
        modelName,
        runId: parts[0] || 'unknown',
        hasModelJson: false,
        hasLabelJson: false,
        hasGeometry: false,
        hasMetadata: false,
        hasRawModel: false,
        hasAssets: false,
        vectorFolder: vectorFolderFromModelRoot(root, modelName),
        vectorComplete: false,
      }
      byRoot.set(root, entry)
    }

    const lower = storagePath.toLowerCase()
    if (lower.endsWith('/json/model.json')) entry.hasModelJson = true
    if (lower.endsWith('/json/label.json')) entry.hasLabelJson = true
    if (lower.includes('/geometry/')) entry.hasGeometry = true
    if (lower.includes('/metadata/')) entry.hasMetadata = true
    if (lower.includes('/raw_model/')) entry.hasRawModel = true
    if (
      lower.includes('/animation/') ||
      lower.includes('/texture/') ||
      lower.includes('/summary/')
    ) {
      entry.hasAssets = true
    }
  }

  return [...byRoot.values()]
    .filter(
      (model) =>
        // Require real model payload — archive roots with only model_zip/textures are skipped.
        model.hasGeometry || model.hasRawModel || model.hasModelJson,
    )
    .sort((a, b) => a.root.localeCompare(b.root))
}

/** Index vector-db packs by presence of model.json + label.json. */
async function buildVectorPackIndex(): Promise<Map<string, VectorPackStatus>> {
  const index = new Map<string, VectorPackStatus>()
  if (!isR2VectorConfigured()) return index

  const paths = await listR2VectorStoragePaths('')
  for (const storagePath of paths) {
    const parts = storagePath.split('/').filter(Boolean)
    if (parts.length < 2) continue
    const folder = parts[0]!
    const file = parts.slice(1).join('/').toLowerCase()
    let entry = index.get(folder)
    if (!entry) {
      entry = { hasModel: false, hasLabel: false, schemaVersion: null }
      index.set(folder, entry)
    }
    if (file === 'model.json') entry.hasModel = true
    if (file === 'label.json') entry.hasLabel = true
  }

  return index
}

function isVectorPackCurrent(status: VectorPackStatus | undefined): boolean {
  // Already labeled = model.json + label.json present. Do not re-label.
  // Schema version is recorded for future selective upgrades, not automatic re-runs.
  return Boolean(status?.hasModel && status.hasLabel)
}

async function readModelFolder(root: string) {
  const childPaths = await listR2StoragePaths(root)
  const [
    metadataBuf,
    summaryBuf,
    elementsBuf,
    outlinerBuf,
    modelBuf,
  ] = await Promise.all([
    getR2ObjectBuffer(`${root}/metadata/metadata.json`),
    getR2ObjectBuffer(`${root}/summary/summary.json`),
    getR2ObjectBuffer(`${root}/geometry/elements.json`),
    getR2ObjectBuffer(`${root}/geometry/outliner.json`),
    getR2ObjectBuffer(`${root}/json/model.json`),
  ])

  // Fallback: some uploads may store metadata at alternate paths
  const metadata =
    (parseJsonBuffer(metadataBuf) as Record<string, unknown> | null) ??
    (parseJsonBuffer(await getR2ObjectBuffer(`${root}/metadata.json`)) as Record<
      string,
      unknown
    > | null) ??
    {}
  const summary =
    (parseJsonBuffer(summaryBuf) as Record<string, unknown> | null) ??
    (parseJsonBuffer(await getR2ObjectBuffer(`${root}/summary.json`)) as Record<
      string,
      unknown
    > | null) ??
    {}
  const existingModel = parseJsonBuffer(modelBuf) as Record<string, unknown> | null

  let elements: unknown[] =
    (Array.isArray(existingModel?.elements) ? (existingModel.elements as unknown[]) : null) ??
    (Array.isArray(parseJsonBuffer(elementsBuf)) ? (parseJsonBuffer(elementsBuf) as unknown[]) : null) ??
    []

  if (elements.length === 0) {
    const nestedElementsPath = childPaths.find((path) =>
      path.toLowerCase().endsWith('/geometry/elements.json'),
    )
    if (nestedElementsPath) {
      const nested = parseJsonBuffer(await getR2ObjectBuffer(nestedElementsPath))
      if (Array.isArray(nested)) elements = nested
    }
  }

  let outliner: unknown[] =
    (Array.isArray(existingModel?.outliner) ? (existingModel.outliner as unknown[]) : null) ??
    (Array.isArray(parseJsonBuffer(outlinerBuf)) ? (parseJsonBuffer(outlinerBuf) as unknown[]) : null) ??
    []

  if (outliner.length === 0) {
    const nestedOutlinerPath = childPaths.find((path) =>
      path.toLowerCase().endsWith('/geometry/outliner.json'),
    )
    if (nestedOutlinerPath) {
      const nested = parseJsonBuffer(await getR2ObjectBuffer(nestedOutlinerPath))
      if (Array.isArray(nested)) outliner = nested
    }
  }

  const animationPaths = childPaths.filter((path) => {
    const rel = path.slice(root.length + 1)
    return (
      (rel.startsWith('animation/') || rel.startsWith('animations/')) &&
      rel.toLowerCase().endsWith('.json') &&
      !rel.toLowerCase().endsWith('animations_manifest.json')
    )
  })

  const animationNames: string[] = []
  const animations: unknown[] = []
  for (const path of animationPaths.slice(0, 40)) {
    const data = parseJsonBuffer(await getR2ObjectBuffer(path))
    if (data && typeof data === 'object') {
      animations.push(data)
      const name =
        typeof (data as { name?: string }).name === 'string'
          ? (data as { name: string }).name
          : path.split('/').pop()?.replace(/\.json$/i, '') || 'animation'
      animationNames.push(name)
    }
  }

  if (animations.length === 0 && Array.isArray(existingModel?.animations)) {
    for (const anim of existingModel.animations) {
      animations.push(anim)
      if (anim && typeof anim === 'object' && typeof (anim as { name?: string }).name === 'string') {
        animationNames.push((anim as { name: string }).name)
      }
    }
  }

  const texturePaths = childPaths.filter((path) => {
    const rel = path.slice(root.length + 1)
    return (
      (rel.startsWith('texture/') || rel.startsWith('textures/')) &&
      /\.(png|jpe?g|webp)$/i.test(rel)
    )
  })

  const textures = texturePaths.map((path, index) => {
    const filename = path.split('/').pop() || `texture_${index}.png`
    return {
      name: filename.replace(/\.(png|jpe?g|webp)$/i, ''),
      path: `texture/${filename}`,
      filename,
    }
  })
  const textureNames = textures.map((t) => t.name)

  let preview: { mimeType: string; data: string; name: string } | null = null
  const preferredTexture =
    texturePaths.find((path) => /skin|body|alex|steve|player|main/i.test(path)) ?? texturePaths[0]
  if (preferredTexture) {
    const img = await getR2ObjectBuffer(preferredTexture)
    if (img && img.byteLength > 0 && img.byteLength <= 4_000_000) {
      const filename = preferredTexture.split('/').pop() || 'texture.png'
      const lower = filename.toLowerCase()
      const mimeType = lower.endsWith('.webp')
        ? 'image/webp'
        : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
          ? 'image/jpeg'
          : 'image/png'
      preview = { mimeType, data: img.toString('base64'), name: filename }
    }
  }

  // Prefer original raw .bbmodel JSON when present (best model.json source).
  const rawModelPath = childPaths.find((path) => {
    const rel = path.slice(root.length + 1)
    return rel.startsWith('raw_model/')
  })
  let model: Record<string, unknown>
  if (rawModelPath) {
    const raw = parseJsonBuffer(await getR2ObjectBuffer(rawModelPath))
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      model = raw as Record<string, unknown>
    } else {
      model = buildModelFromParts({
        root,
        metadata,
        elements,
        outliner,
        textures,
        animations,
      })
    }
  } else if (existingModel) {
    model = existingModel
  } else {
    model = buildModelFromParts({
      root,
      metadata,
      elements,
      outliner,
      textures,
      animations,
    })
  }

  // Many extracts keep PNG only as embedded data URIs inside the bbmodel.
  if (!preview) {
    preview = extractEmbeddedTexture(model)
  }

  const embeddedNames = (Array.isArray(model.textures) ? model.textures : [])
    .map((item) =>
      item && typeof item === 'object' && typeof (item as { name?: string }).name === 'string'
        ? (item as { name: string }).name
        : null,
    )
    .filter((value): value is string => Boolean(value))
  const allTextureNames = [...new Set([...textureNames, ...embeddedNames])]

  const modelElements = (Array.isArray(model.elements) ? model.elements : elements) as unknown[]
  const elementCount = modelElements.length
  const cubeCount = countCubes(modelElements)

  const folderName = root.split('/').pop() || root
  const analysis = {
    folder_name: folderName,
    display_name: (metadata.name as string) ?? (model.name as string) ?? folderName,
    model_format: metadata.model_format ?? model.model_format ?? null,
    resolution: metadata.resolution ?? model.resolution ?? null,
    summary,
    element_count: elementCount,
    cube_count: cubeCount,
    suggested_complexity: complexityFromCounts(cubeCount, elementCount),
    sample_element_names: modelElements
      .slice(0, 40)
      .map((el) => (el && typeof el === 'object' ? (el as { name?: string }).name : null))
      .filter(Boolean),
    bone_names: collectOutlinerNames(
      (Array.isArray(model.outliner) ? model.outliner : outliner) as unknown[],
    ),
    animation_names: animationNames,
    texture_names: allTextureNames,
    has_animation: animationNames.length > 0 || Number(summary.animationCount ?? 0) > 0,
    has_metadata: Boolean(metadataBuf) || Object.keys(metadata).length > 0,
  }

  return { model, analysis, preview }
}

const MAX_EMBEDDED_TEXTURE_BYTES = 4_000_000

function decodeEmbeddedSource(
  source: unknown,
  nameHint: string,
): { mimeType: string; data: string; name: string } | null {
  if (typeof source !== 'string' || source.length < 32) return null

  let mimeType = 'image/png'
  let data = source
  if (source.startsWith('data:')) {
    const match = /^data:([^;]+);base64,(.+)$/s.exec(source)
    if (!match?.[1] || !match[2]) return null
    mimeType = match[1]
    data = match[2]
  } else if (!/^[A-Za-z0-9+/=\s]+$/.test(source.slice(0, 200))) {
    return null
  }

  data = data.replace(/\s+/g, '')
  if (Math.floor((data.length * 3) / 4) > MAX_EMBEDDED_TEXTURE_BYTES) return null

  const nameRaw = nameHint.trim() || 'texture'
  const ext =
    mimeType.includes('webp') ? '.webp' : mimeType.includes('jpeg') || mimeType.includes('jpg') ? '.jpg' : '.png'
  const name = /\.(png|jpe?g|webp)$/i.test(nameRaw) ? nameRaw : `${nameRaw}${ext}`
  return { mimeType, data, name }
}

/** Pull primary texture from Blockbench embedded `textures[].source` data URIs / base64. */
function extractEmbeddedTexture(
  model: Record<string, unknown>,
): { mimeType: string; data: string; name: string } | null {
  const textures = Array.isArray(model.textures) ? model.textures : []
  const ordered = [...textures].sort((a, b) => {
    const rank = (item: unknown) => {
      if (!item || typeof item !== 'object') return 0
      const name = String((item as { name?: string }).name || '')
      return /skin|body|alex|steve|player|main/i.test(name) ? 0 : 1
    }
    return rank(a) - rank(b)
  })

  for (const item of ordered) {
    if (!item || typeof item !== 'object') continue
    const name = String((item as { name?: string }).name || 'texture')
    const decoded = decodeEmbeddedSource((item as { source?: unknown }).source, name)
    if (decoded) return decoded
  }
  return null
}

function buildModelFromParts(input: {
  root: string
  metadata: Record<string, unknown>
  elements: unknown[]
  outliner: unknown[]
  textures: Array<Record<string, unknown>>
  animations: unknown[]
}): Record<string, unknown> {
  const folderName = input.root.split('/').pop() || input.root
  const { metadata, elements, outliner, textures, animations } = input
  return {
    meta: {
      format_version: '4.10',
      model_format: metadata.model_format ?? 'free',
      box_uv: metadata.box_uv ?? false,
    },
    name: (metadata.name as string) ?? folderName,
    elements,
    outliner,
    ...(metadata.model_identifier != null ? { model_identifier: metadata.model_identifier } : {}),
    ...(metadata.format_version != null ? { format_version: metadata.format_version } : {}),
    ...(metadata.model_format != null ? { model_format: metadata.model_format } : {}),
    ...(typeof metadata.box_uv === 'boolean' ? { box_uv: metadata.box_uv } : {}),
    ...(metadata.resolution != null ? { resolution: metadata.resolution } : {}),
    ...(metadata.visible_box != null ? { visible_box: metadata.visible_box } : {}),
    ...(metadata.uuid != null ? { uuid: metadata.uuid } : {}),
    ...(textures.length > 0 ? { textures } : {}),
    ...(animations.length > 0 ? { animations } : {}),
  }
}

function collectOutlinerNames(nodes: unknown, names: string[] = [], depth = 0): string[] {
  if (!Array.isArray(nodes) || depth > 12 || names.length >= 80) return names
  for (const node of nodes) {
    if (names.length >= 80) break
    if (typeof node === 'string') {
      names.push(node)
      continue
    }
    if (!node || typeof node !== 'object') continue
    const record = node as { name?: string; children?: unknown }
    if (typeof record.name === 'string' && record.name.trim()) names.push(record.name)
    if (Array.isArray(record.children)) collectOutlinerNames(record.children, names, depth + 1)
  }
  return names
}

function extractJsonObject(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```json|```/g, '').trim()
  try {
    return JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
    }
    throw new Error('Gemini did not return valid JSON')
  }
}

function normalizeLabelResult(
  raw: Record<string, unknown>,
  analysis: Record<string, unknown>,
  modelId: string,
  source: string,
): Record<string, unknown> {
  const rawCategory = String(raw.category || '')
    .trim()
    .toLowerCase()
  const categoryValid = isRagCategory(rawCategory)

  const cubeCount =
    typeof analysis.cube_count === 'number'
      ? analysis.cube_count
      : typeof analysis.element_count === 'number'
        ? analysis.element_count
        : 0
  const elementCount = typeof analysis.element_count === 'number' ? analysis.element_count : cubeCount
  const complexity = COMPLEXITIES.includes(raw.complexity as (typeof COMPLEXITIES)[number])
    ? (raw.complexity as string)
    : complexityFromCounts(cubeCount, elementCount)

  const confidence = CONFIDENCE_LEVELS.includes(raw.confidence as (typeof CONFIDENCE_LEVELS)[number])
    ? (raw.confidence as string)
    : 'medium'

  const colorPalette = Array.isArray(raw.color_palette)
    ? raw.color_palette.map(String).map((c) => c.trim().toLowerCase()).filter(Boolean).slice(0, 8)
    : []

  const hasAnimation = Boolean(analysis.has_animation ?? raw.has_animation)
  const folderHint = String(analysis.folder_name || analysis.model_name || '')
  const reconciled = reconcileTaxonomy({
    category: categoryValid ? rawCategory : 'prop',
    subcategory:
      raw.subcategory != null && String(raw.subcategory).trim()
        ? String(raw.subcategory).trim().toLowerCase().replace(/\s+/g, '-')
        : null,
    folderHint,
  })
  const category = reconciled.category
  const subcategory = reconciled.subcategory ?? undefined
  const description = sanitizeDescriptionForRag(String(raw.description || '').trim())
  const embeddingText = sanitizeEmbeddingTextForRag(
    String(raw.embedding_text || '').trim(),
    hasAnimation,
    category,
    subcategory,
    folderHint,
  )

  const styleTags = pruneTagList(raw.style_tags, 12)
  const materialTags = pruneTagList(raw.material_tags, 8)
  const needsReview =
    (typeof raw.needs_review === 'boolean' ? raw.needs_review : confidence === 'low') ||
    !categoryValid ||
    reconciled.needsReview

  return {
    description,
    embedding_text: embeddingText,
    category,
    ...(subcategory ? { subcategory } : {}),
    style_tags: styleTags,
    material_tags: materialTags,
    color_palette: colorPalette,
    complexity,
    cube_count: cubeCount,
    confidence,
    needs_review: needsReview,
    has_animation: hasAnimation,
    has_metadata: Boolean(raw.has_metadata ?? analysis.has_metadata),
    label_schema_version: LABEL_SCHEMA_VERSION,
    _draft: false,
    _source: source,
    _model: modelId,
    _source_folder: analysis.folder_name,
    _labeled_at: new Date().toISOString(),
    ...(!categoryValid || reconciled.coerced
      ? {
          _category_coerced_from: rawCategory || null,
          _subcategory_coerced_from:
            raw.subcategory != null ? String(raw.subcategory) : null,
          _taxonomy_reconciled: true,
        }
      : {}),
  }
}

function sanitizeDescriptionForRag(text: string): string {
  if (!text) return text
  // Drop trailing animation-list sentences the model sometimes appends.
  return text
    .replace(
      /\s*(?:It\s+)?(?:Includes?|Features?|Has|With)\s+(?:GeckoLib\s+)?(?:idle\/walk(?:\/[\w/-]+)?\s+)?(?:clips?|animations?)[^.]*\.?/gi,
      '',
    )
    .replace(
      /\s*(?:Animations?(?:\s+include|\s+include:|\s*:)\s*)[^.]*\.?/gi,
      '',
    )
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.!?])/g, '$1')
    .trim()
}

function buildLabelInstruction(options?: { textOnly?: boolean }): string {
  const visionNote = options?.textOnly
    ? `You do NOT have an image. Infer appearance ONLY from folder_name, bone_names, element_names, animation_names, texture_names, and counts. For color_palette, use only colors implied by names (e.g. "redstone", "gold"); otherwise [].`
    : `If a texture preview image is attached, use it together with the JSON facts. Prefer the texture for color_palette.`

  return `You are labeling a Blockbench / Minecraft-style 3D model for a RAG search library.

Analyze the model facts carefully.
${visionNote}

Return ONLY a JSON object with these fields:
- description (string)
- embedding_text (string)
- category (MUST be exactly one of: character, prop, creature, environment — no other values)
- subcategory (kebab-case string from the taxonomy below)
- style_tags (string array)
- material_tags (string array)
- color_palette (string array of dominant color words)
- complexity (one of: simple, medium, complex)
- confidence (one of: low, medium, high)
- needs_review (boolean)
- has_animation (boolean)
- has_metadata (boolean)

Field roles (important for later retrieval):
- description: human/LLM context after a model is retrieved. Natural prose.
- embedding_text: the text that will be embedded for search. Dense, specific, synonym-rich. This field matters most for finding the model.
- color_palette / complexity / cube_count (cube_count is filled server-side from geometry): filters for matching request style and detail level.
- confidence / needs_review: triage flag — do not treat every AI label as equally trustworthy.

Category decision rules (STRICT — pick exactly one; this drives filter_category):
- character: playable or person-like figures — player skins (Steve/Alex), humanoid personas, role NPCs (warrior, mage, knight), civilian humans. NOT undead/monsters/animals.
- creature: mobs and non-player fauna/monsters — zombie, skeleton, cow, wolf, dragon, golem, slime, hostile/passive mobs, animals, mythical beasts. Minecraft villager-type mobs → creature (subcategory villager), not character.
- prop: handheld or placeable objects — weapons, furniture, tools, vehicles, machines, food, items, gadgets. NEVER use prop for buildings/fortresses/houses.
- environment: world scenery and placeables that define a place — buildings, fortresses, castles, houses, towers, ruins, dungeons, terrain, caves, bridges, foliage, trees, biome pieces. A standalone fortress/building model = environment (usually subcategory structure, building, fortress, or castle).
- Do NOT invent extra top-level categories (no weapon, vehicle, structure, item as category). Those are subcategories under prop or environment.
- If unsure between character and creature: player skin / named human role → character; mob/species/undead/animal → creature. Set needs_review true when still ambiguous.
- If unsure between prop and environment: can you hold/wear/place it as an object? → prop; is it a building or landscape piece? → environment.

Rules for description (RAG-optimized):
- 2–4 full sentences (50–110 words)
- First sentence MUST state the specific identity (not a vague parent class). Examples:
  - "A futuristic bolt-action sniper rifle prop for Minecraft/GeckoLib."
  - "A compact sci-fi handgun / pistol prop."
  - "A bipedal undead zombie hostile mob with torn clothing."
  - "A wooden dining chair furniture prop."
  - "A stone fortress tower environment piece with battlements."
- Focus ONLY on identity and appearance: subject, silhouette/parts, visual style, materials, colors, in-game use
- Do NOT mention animations, clips, idle/walk/run/attack, or GeckoLib motion at all in description
- Motion belongs in has_animation only (boolean). Description is for what the model looks like after retrieval.
- Be specific (exact class, species/role, colors, shape). Avoid vague filler ("detailed 3D model", "high quality", bare "gun" / "weapon" / "mob" / "item" / "prop")
- Do NOT only restate the folder name

Rules for embedding_text (RAG search — most important field):
- One dense line of 20–45 natural space-separated phrases (NOT a paragraph, NOT a title)
- Write embedding_text the way a user would type a search query: spaces only — NEVER hyphens or underscores (e.g. "sniper rifle" not "sniper-rifle"; "hostile mob" not "hostile-mob"; "sci fi" not "sci-fi")
- Include the chosen category token EXACTLY once (character OR prop OR creature OR environment). Do NOT include any other category word from that list
- Include subcategory meaning as space-separated words (subcategory sniper-rifle → tokens "sniper" "rifle")
- Also include: primary name, aliases/synonyms within the SAME class, notable parts, style words, dominant colors, use-cases
- ALWAYS echo the specific class, plus useful same-family synonyms (handgun → also "pistol sidearm firearm gun"; never also "creature" or "environment")
- MUST include distinctive tokens from folder_name / model name near the start (e.g. folder beacon_sniper → include "beacon sniper"; tnt_shotgun → "tnt shotgun"). Do not replace a sniper with generic "rifle" only
- NEVER invent a different weapon class than the folder implies (do not label a shotgun folder as laser rifle)
- Put the MOST distinctive identity tokens first, then style/color
- Prefer concrete tokens users would search:
  - "beacon sniper sniper rifle scoped long barrel laser energy sci fi futuristic glowing blue prop combat"
  - "tnt shotgun shotgun explosive wide barrel pump combat prop"
  - "zombie undead hostile mob bipedal rotting green torn cloth creature"
  - "oak dining chair furniture seat wooden brown prop household"
  - "bastion light stone fortress tower battlements castle structure environment"
- Include alternate phrasings when useful (e.g. "cow bovine cattle farm animal passive mob")
- Do NOT include generic filler: model, asset, blockbench, minecraft, gaming, detailed, quality, nice, cool
- Animation policy (strict): set has_animation correctly. In embedding_text include EXACTLY one of "animated" or "static" — NEVER clip names (idle, walk, run, attack, swim, death, jump, sit, etc.)
- No punctuation; no sentences

Rules for color_palette:
- 2–6 short color words (e.g. "blue", "white", "brown", "gold", "black")
- Dominant / signature colors only, not every pixel nuance
- Empty array if colors are unknown

Rules for complexity:
- Prefer analysis.suggested_complexity when present (derived from cube/element counts)
- simple ≈ few cubes / basic silhouette; medium ≈ typical mob/item; complex ≈ highly detailed multi-part model

Rules for material_tags (accuracy matters — do not invent):
- Only tag materials with clear evidence from texture appearance OR names (e.g. "iron", "wood", "leather" in filename/bones)
- Do NOT guess materials from color alone (blue ≠ diamond, brown ≠ wood, gray ≠ stone/metal)
- Prefer [] or 1–2 high-confidence tags over a speculative list
- Good examples when justified: cloth, metal, wood, stone, skin, leather, glass, crystal, organic

Rules for confidence / needs_review:
- high: subject is clear from name + structure (+ texture if present)
- medium: plausible but some ambiguity
- low: unclear texture, weird/generic geometry, conflicting names, or heavy guessing required
- needs_review: true when confidence is low OR category/identity is uncertain

Other rules:
- Prefer accurate category over guessing "prop"
- subcategory MUST be the most specific valid class below — NEVER stop at a vague parent (weapon, gun, item, mob, creature, object, prop, furniture, vehicle, structure) when a child class is clear
- If folder/name contains sniper / shotgun / minigun / pistol / etc., subcategory MUST be that child class (sniper-rifle, shotgun, lmg, handgun…) — never bare "weapon" or "gun"
- Prefer kebab-case single tokens for the subcategory FIELD only (sniper-rifle, passive-mob, dining-chair). embedding_text uses spaces for the same ideas
- If none fit, invent a short specific kebab-case type — do not fall back to "item"/"object" unless truly unknown
- Mirror clear name cues from folder/bones/textures into subcategory + description + embedding_text

Subcategory taxonomy (pick ONE best match; use child class, not the parent header):

category=character:
- player, npc, warrior, knight, soldier, archer, mage, wizard, witch, rogue, assassin, hunter, merchant, civilian, armored, caster, humanoid
- Prefer role when clear (mage over humanoid; knight over armored)
- Player-default skins (Alex, Steve, similar) → subcategory player
- Do NOT use character for Minecraft villager mobs (those are creature)

category=creature:
- passive-mob, hostile-mob, boss, quadruped, bipedal, flying, aquatic, arthropod, undead, dragon, golem, elemental, slime, farm-animal, pet, mythical, villager
- Prefer species/role when clear (e.g. zombie, skeleton, creeper, enderman, spider, wolf, cat, horse, cow, pig, sheep, chicken, villager-golem) — species token IS a valid subcategory
- Villager mobs and golems live here, not under character

category=prop:
  Weapons / combat (never bare weapon/gun):
  - sniper-rifle, assault-rifle, rifle, handgun, pistol, shotgun, smg, lmg, launcher, bow, crossbow, sword, dagger, axe, spear, trident, staff, wand, shield, armor, helmet, chestplate, tool, pickaxe, shovel, hoe, fishing-rod
  Furniture / household:
  - chair, table, desk, bed, sofa, shelf, cabinet, door, window, lamp, candle, painting, carpet, clock, chest, crate, barrel, container
  Tech / machines:
  - machine, console, terminal, screen, robot, drone, gadget, battery, crystal, portal, trap
  Vehicles / mounts:
  - vehicle, car, truck, tank, boat, ship, plane, helicopter, motorcycle, minecart, mount
  World / blocks / nature props:
  - block, ore, food, potion, book, scroll, key, coin, gem, trophy, flag, sign, totem, statue, skull, bone, corpse, debris
  Default prop fallback only if nothing above fits: item

category=environment:
- structure, building, house, fortress, castle, tower, ruins, dungeon, cave, terrain, rock, mountain, bridge, road, foliage, tree, bush, flower, grass, crop, water, lava, sky, weather, biome-prop
- Standalone buildings/fortresses/castles → structure, building, fortress, or castle (NOT prop)

Classification cues:
- Firearms: long barrel + stock/scope ⇒ sniper-rifle/rifle; compact grip/slide ⇒ handgun/pistol; wide tube ⇒ shotgun; mid barrel + magazine ⇒ assault-rifle/smg
- Mobs: undead cues ⇒ undead or species (zombie/skeleton); farm names ⇒ farm-animal or species; wings ⇒ flying; fins/swim bones ⇒ aquatic
- Furniture: seat + legs ⇒ chair; flat top + legs ⇒ table; storage lid ⇒ chest/crate
- Buildings / large static scenery ⇒ environment + structure/building/fortress/house; plants ⇒ foliage/tree/bush/flower
- style_tags: 3–8 specific visual tags only (scoped, long-barrel, sidearm, bipedal, undead, wooden, ornate). Never use gaming, minecraft, blockbench, 3d, model, asset, detailed, quality
- Use bone/element/texture names as primary evidence. Animation names may only help set has_animation / category — never copy clip names into description or embedding_text
- Ignore generic names like "cube", "bone", "group"`
}

async function labelWithOpenRouter(
  analysis: Record<string, unknown>,
  preview: { mimeType: string; data: string; name: string } | null,
  modelId: string,
): Promise<Record<string, unknown>> {
  if (!OPENROUTER_API_KEY?.trim()) throw new Error('OPENROUTER_API_KEY is not configured')

  const promptText = `${buildLabelInstruction({ textOnly: !preview })}\n\nModel analysis JSON:\n${JSON.stringify(analysis, null, 2)}`
  const estimatedTokens = estimateLabelTokens(promptText.length, Boolean(preview))

  type ContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }

  const userContent: ContentPart[] = [{ type: 'text', text: promptText }]
  if (preview) {
    userContent.push({
      type: 'image_url',
      image_url: {
        url: `data:${preview.mimeType};base64,${preview.data}`,
      },
    })
    userContent.push({
      type: 'text',
      text: `Attached texture preview filename: ${preview.name}`,
    })
  }

  return modelLabelRateLimiter.schedule(modelId, estimatedTokens, async () => {
    let lastError: Error | null = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'HTTP-Referer': OPENROUTER_HTTP_REFERER,
            'X-Title': OPENROUTER_APP_TITLE,
          },
          body: JSON.stringify({
            model: modelId,
            temperature: 0.2,
            max_tokens: 1200,
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content:
                  'Return only valid JSON matching the requested label schema. No markdown fences.',
              },
              { role: 'user', content: userContent },
            ],
          }),
        })

        modelLabelRateLimiter.ingestLiveHeaders(modelId, response.headers)

        const payload = (await response.json()) as {
          error?: { message?: string }
          choices?: Array<{ message?: { content?: string } }>
        }

        if (!response.ok) {
          throw new Error(payload.error?.message || `OpenRouter request failed (${response.status})`)
        }

        const text = payload.choices?.[0]?.message?.content
        if (!text) throw new Error('Empty OpenRouter response')
        return normalizeLabelResult(extractJsonObject(text), analysis, modelId, 'openrouter-batch')
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        const message = lastError.message.toLowerCase()
        const retryable =
          message.includes('429') ||
          message.includes('rate') ||
          message.includes('quota') ||
          message.includes('unavailable') ||
          message.includes('503') ||
          message.includes('timeout') ||
          message.includes('overloaded')
        if (!retryable || attempt === 2) break
        const waitMs = (attempt + 1) * 8_000
        pushLog('warn', `OpenRouter retry in ${waitMs}ms: ${lastError.message}`)
        await new Promise((resolve) => setTimeout(resolve, waitMs))
      }
    }
    throw lastError ?? new Error('OpenRouter labeling failed')
  })
}

async function labelWithNvidia(
  analysis: Record<string, unknown>,
  preview: { mimeType: string; data: string; name: string } | null,
  modelId: string,
): Promise<Record<string, unknown>> {
  if (!NVIDIA_API_KEY?.trim()) throw new Error('NVIDIA_API_KEY is not configured')

  const apiModel = nvidiaApiModelId(modelId)
  const promptText = `${buildLabelInstruction({ textOnly: !preview })}\n\nModel analysis JSON:\n${JSON.stringify(analysis, null, 2)}`
  const estimatedTokens = estimateLabelTokens(promptText.length, Boolean(preview))

  type ContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }

  const userContent: ContentPart[] = [{ type: 'text', text: promptText }]
  if (preview) {
    userContent.push({
      type: 'image_url',
      image_url: {
        url: `data:${preview.mimeType};base64,${preview.data}`,
      },
    })
    userContent.push({
      type: 'text',
      text: `Attached texture preview filename: ${preview.name}`,
    })
  }

  return modelLabelRateLimiter.schedule(modelId, estimatedTokens, async () => {
    let lastError: Error | null = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${NVIDIA_API_KEY}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            model: apiModel,
            temperature: 0.2,
            max_tokens: 1200,
            messages: [
              {
                role: 'system',
                content:
                  'Return only valid JSON matching the requested label schema. No markdown fences.',
              },
              { role: 'user', content: userContent },
            ],
          }),
        })

        const payload = (await response.json()) as {
          error?: { message?: string }
          choices?: Array<{ message?: { content?: string } }>
        }

        if (!response.ok) {
          throw new Error(payload.error?.message || `NVIDIA NIM request failed (${response.status})`)
        }

        const text = payload.choices?.[0]?.message?.content
        if (!text) throw new Error('Empty NVIDIA NIM response')
        return normalizeLabelResult(extractJsonObject(text), analysis, modelId, 'nvidia-nim')
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        const message = lastError.message.toLowerCase()
        const retryable =
          message.includes('429') ||
          message.includes('rate') ||
          message.includes('quota') ||
          message.includes('unavailable') ||
          message.includes('503') ||
          message.includes('timeout') ||
          message.includes('overloaded')
        if (!retryable || attempt === 2) break
        const waitMs = (attempt + 1) * 4_000
        pushLog('warn', `NVIDIA NIM retry in ${waitMs}ms: ${lastError.message}`)
        await new Promise((resolve) => setTimeout(resolve, waitMs))
      }
    }
    throw lastError ?? new Error('NVIDIA NIM labeling failed')
  })
}

export async function labelWithModel(
  analysis: Record<string, unknown>,
  preview: { mimeType: string; data: string; name: string } | null,
  modelId: string,
): Promise<Record<string, unknown>> {
  if (providerForModel(modelId) === 'nvidia') {
    return labelWithNvidia(analysis, preview, modelId)
  }
  return labelWithOpenRouter(analysis, preview, modelId)
}

/** Resolve + validate a labeling model for local upload / external callers. */
export function resolveRagLabelModel(requested?: string | null): string {
  return resolveLabelModel(requested)
}

export function assertRagProviderConfigured(modelId: string): void {
  const provider = providerForModel(resolveLabelModel(modelId))
  if (!isProviderConfigured(provider)) {
    throw new Error(providerKeyError(provider))
  }
}

function createUserSupabase(accessToken: string | null): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function resolveRunContext(
  supabase: SupabaseClient | null,
  root: string,
  fallbackModelName: string,
): Promise<{ runId: string | null; modelName: string; userEmail: string | null }> {
  if (!supabase) {
    return { runId: null, modelName: fallbackModelName, userEmail: null }
  }
  const { data, error } = await supabase
    .from('extracted_files')
    .select('run_id, model_name, user_email')
    .like('storage_path', `${root}/%`)
    .limit(1)

  if (error || !data?.[0]) {
    return { runId: null, modelName: fallbackModelName, userEmail: null }
  }

  return {
    runId: typeof data[0].run_id === 'string' ? data[0].run_id : null,
    modelName:
      typeof data[0].model_name === 'string' && data[0].model_name.trim()
        ? data[0].model_name
        : fallbackModelName,
    userEmail: typeof data[0].user_email === 'string' ? data[0].user_email : null,
  }
}

async function processModel(
  model: ModelJob,
  options: { dryRun: boolean; labelModel: string },
  supabase: SupabaseClient | null,
): Promise<'done' | 'skipped'> {
  if (model.vectorComplete) {
    return 'skipped'
  }

  const { model: modelJson, analysis, preview } = await readModelFolder(model.root)
  if (!Array.isArray(modelJson.elements) || modelJson.elements.length === 0) {
    // Skip archive/incomplete folders — guessing labels from folder names is unreliable.
    pushLog(
      'warn',
      `Skipped ${model.root}: no geometry/elements found (likely a zip archive folder, not a model)`,
    )
    return 'skipped'
  }

  const label = await labelWithModel(analysis, preview, options.labelModel)
  const elementCount = Array.isArray(modelJson.elements) ? modelJson.elements.length : 0
  const context = await resolveRunContext(supabase, model.root, model.modelName)
  const folder = vectorFolderFromModelRoot(model.root, context.modelName || model.modelName)

  if (options.dryRun) {
    pushLog(
      'info',
      `[dry-run] ${model.root} → vector-db/${folder}/ (elements=${elementCount})` +
        ` (${String(label.category)} / ${String(label.subcategory ?? '—')})` +
        ` schema=v${LABEL_SCHEMA_VERSION}`,
    )
    pushLog(
      'info',
      `[dry-run] vector-db/${folder}/model.json summary:\n${JSON.stringify(
        {
          meta: modelJson.meta ?? null,
          name: modelJson.name ?? model.modelName,
          elements: elementCount,
          groups: Array.isArray(modelJson.groups) ? modelJson.groups.length : 0,
          textures: Array.isArray(modelJson.textures) ? modelJson.textures.length : 0,
          animations: Array.isArray(modelJson.animations) ? modelJson.animations.length : 0,
        },
        null,
        2,
      )}`,
    )
    pushLog(
      'info',
      `[dry-run] vector-db/${folder}/label.json:\n${JSON.stringify(label, null, 2)}`,
    )
    return 'done'
  }

  if (!isR2VectorConfigured()) {
    throw new Error('R2_VECTOR_BUCKET is not configured — corpus writes go only to vector-db')
  }

  const texture =
    preview?.data && preview.mimeType
      ? {
          bytes: Buffer.from(preview.data, 'base64'),
          mimeType: preview.mimeType,
          filename: preview.name,
        }
      : null

  const synced = await syncModelToVectorBucket({
    folderName: folder,
    modelJson,
    labelJson: label,
    texture,
    meta: {
      source_root: model.root,
      model_name: context.modelName || model.modelName,
      category: label.category ?? null,
      subcategory: label.subcategory ?? null,
      label_schema_version: LABEL_SCHEMA_VERSION,
      confidence: label.confidence ?? null,
      needs_review: label.needs_review ?? null,
      complexity: label.complexity ?? null,
      cube_count: label.cube_count ?? null,
    },
  })

  pushLog(
    'info',
    `Labeled ${model.root} → vector-db/${synced.folder}/ ` +
      `${String(label.category)}${label.subcategory ? `/${String(label.subcategory)}` : ''}` +
      ` (${synced.paths.map((p) => p.split('/').pop()).join(', ')})`,
  )

  const auto = await runAutoIndexVectorFolder(synced.folder)
  if (auto.status === 'indexed') {
    pushLog('info', `Auto-embedded → rag_models: ${auto.folder}`)
  } else if (auto.status === 'disabled') {
    pushLog('info', `Auto-embed OFF — not indexing ${auto.folder}`)
  } else if (auto.status === 'skipped') {
    pushLog('info', `Auto-embed skipped ${auto.folder}${auto.reason ? ` (${auto.reason})` : ''}`)
  } else {
    pushLog('warn', `Auto-embed failed ${auto.folder}${auto.reason ? `: ${auto.reason}` : ''}`)
  }

  return 'done'
}

async function runBatch(options: {
  dryRun: boolean
  limit: number
  labelModel: string
  accessToken: string | null
  userEmail: string | null
}): Promise<void> {
  abortRequested = false
  job.status = 'running'
  job.startedAt = new Date().toISOString()
  job.finishedAt = null
  job.force = false
  job.dryRun = options.dryRun
  job.limit = options.limit
  job.selectedModel = options.labelModel
  job.completed = 0
  job.skipped = 0
  job.failed = 0
  job.results = []
  job.lastError = null
  job.currentModel = null
  pushLog(
    'info',
    `Batch started (model=${options.labelModel}, provider=${providerForModel(options.labelModel)}, limit=${options.limit}, dryRun=${options.dryRun}, corpus=vector-db, schema=v${LABEL_SCHEMA_VERSION})`,
  )

  try {
    if (!isR2Configured()) throw new Error('Cloudflare R2 is not configured')
    if (!isR2VectorConfigured()) {
      throw new Error('R2_VECTOR_BUCKET is not configured — auto-label writes only to vector-db')
    }
    const provider = providerForModel(options.labelModel)
    if (!isProviderConfigured(provider)) {
      throw new Error(providerKeyError(provider))
    }

    const rate = modelLabelRateLimiter.getStatus(options.labelModel)
    if (rate.rpdRemaining <= 0) {
      throw new Error(
        `Daily limit already used for ${options.labelModel} (${rate.rpdLimit} RPD).`,
      )
    }

    pushLog('info', 'Listing extract models from R2…')
    const paths = await listR2StoragePaths('')
    let models = discoverModels(paths)

    pushLog('info', 'Indexing vector-db corpus (skip already-labeled packs)…')
    const vectorIndex = await buildVectorPackIndex()
    let alreadyInCorpus = 0
    for (const model of models) {
      const status = vectorIndex.get(model.vectorFolder)
      model.vectorComplete = isVectorPackCurrent(status)
      if (model.vectorComplete) alreadyInCorpus += 1
    }

    models = models.filter((model) => !model.vectorComplete)
    models = models.slice(0, options.limit)
    job.total = models.length
    pushLog(
      'info',
      `Queued ${models.length} model(s) for vector-db (skipped ${alreadyInCorpus} already labeled). RPD remaining before run: ${rate.rpdRemaining}`,
    )

    const supabase = createUserSupabase(options.accessToken)

    for (const model of models) {
      if (abortRequested) {
        job.status = 'cancelled'
        pushLog('warn', 'Batch cancelled by user')
        break
      }

      const rateNow = modelLabelRateLimiter.getStatus(options.labelModel)
      if (rateNow.rpdRemaining <= 0) {
        pushLog('warn', `Stopping early: daily RPD limit reached for ${options.labelModel}`)
        break
      }

      job.currentModel = model.root
      try {
        const result = await processModel(
          model,
          { dryRun: options.dryRun, labelModel: options.labelModel },
          supabase,
        )
        if (result === 'skipped') {
          job.skipped += 1
          job.results.push({ root: model.root, status: 'skipped', reason: 'already in vector-db' })
          pushLog('info', `Skipped ${model.root} (already in vector-db/${model.vectorFolder}/)`)
        } else {
          job.completed += 1
          job.results.push({ root: model.root, status: 'done' })
        }
      } catch (error) {
        job.failed += 1
        const message = error instanceof Error ? error.message : String(error)
        job.lastError = message
        job.results.push({ root: model.root, status: 'failed', reason: message })
        pushLog('error', `Failed ${model.root}: ${message}`)

        if (/daily .+ label limit/i.test(message)) {
          pushLog('warn', 'Stopping batch due to daily limit')
          break
        }
      }
    }

    if (job.status === 'running') {
      job.status = job.failed > 0 && job.completed === 0 ? 'failed' : 'completed'
    }
  } catch (error) {
    job.status = 'failed'
    job.lastError = error instanceof Error ? error.message : String(error)
    pushLog('error', job.lastError)
  } finally {
    job.currentModel = null
    job.finishedAt = new Date().toISOString()
    abortRequested = false
    pushLog(
      'info',
      `Batch finished: done=${job.completed} skipped=${job.skipped} failed=${job.failed} status=${job.status}`,
    )
  }
}

function publicState(preferredModel?: string) {
  const model = preferredModel || job.selectedModel || resolveLabelModel(OPENROUTER_LABEL_MODEL)
  const provider = providerForModel(model)
  const rateLimit = modelLabelRateLimiter.getStatus(model)
  const published = getModelRateCaps(model)
  const openrouterReady = Boolean(OPENROUTER_API_KEY?.trim())
  const nvidiaReady = Boolean(NVIDIA_API_KEY?.trim())
  return {
    ...job,
    rateLimit,
    autoEmbedEnabled: isAutoEmbedEnabled(),
    caps: {
      rpm: rateLimit.rpmLimit,
      tpm: rateLimit.tpmLimit,
      rpd: rateLimit.rpdLimit,
      maxPerRun: RAG_BATCH_MAX_PER_RUN,
    },
    model,
    selectedModel: job.selectedModel || model,
    availableModels: RAG_LABEL_MODELS.map((option) => {
      const caps = getModelRateCaps(option.id)
      const pricing = cachedModelPricing.get(option.id)
      const ready = option.provider === 'nvidia' ? nvidiaReady : openrouterReady
      return {
        ...option,
        configured: ready,
        rpm: caps.rpm,
        tpm: caps.tpm,
        rpd: caps.rpd,
        promptPerMillion: pricing?.promptPerMillion,
        completionPerMillion: pricing?.completionPerMillion,
        priceLabel:
          pricing?.priceLabel ??
          (option.provider === 'nvidia' ? 'NIM API' : option.id.includes(':free') ? 'Free' : undefined),
      }
    }),
    provider,
    publishedCaps: published,
    configured:
      isR2Configured() &&
      isR2VectorConfigured() &&
      (openrouterReady || nvidiaReady),
    vectorBucketConfigured: isR2VectorConfigured(),
    labelSchemaVersion: LABEL_SCHEMA_VERSION,
    providers: {
      openrouter: openrouterReady,
      nvidia: nvidiaReady,
    },
    openrouterUsage: cachedOpenRouterUsage,
  }
}

export async function ragBatchStatusHandler(req: Request, res: Response): Promise<void> {
  const model =
    typeof req.query.model === 'string' ? resolveLabelModel(req.query.model) : undefined
  await Promise.all([fetchOpenRouterUsage(false), fetchOpenRouterModelPricing(false)])
  res.json(publicState(model))
}

export async function ragBatchStartHandler(req: Request, res: Response): Promise<void> {
  if (job.status === 'running' || job.status === 'cancelling' || runner) {
    res.status(409).json({ error: 'A labeling batch is already running', state: publicState() })
    return
  }

  if (!isR2Configured()) {
    res.status(503).json({ error: 'Cloudflare R2 is not configured' })
    return
  }
  if (!isR2VectorConfigured()) {
    res.status(503).json({
      error: 'R2_VECTOR_BUCKET is not configured — auto-label writes only to vector-db',
    })
    return
  }

  const body = (req.body ?? {}) as StartBody
  const labelModel = resolveLabelModel(body.model)
  const provider = providerForModel(labelModel)

  if (!isProviderConfigured(provider)) {
    res.status(503).json({
      error: providerKeyError(provider),
      state: publicState(labelModel),
    })
    return
  }

  const rate = modelLabelRateLimiter.getStatus(labelModel)
  if (rate.rpdRemaining <= 0) {
    res.status(429).json({
      error: `Daily limit reached for ${labelModel} (${rate.rpdLimit} RPD). Try again tomorrow or pick another model.`,
      state: publicState(labelModel),
    })
    return
  }

  const requested = Number(body.limit ?? 20)
  const limit = Math.max(
    1,
    Math.min(
      Number.isFinite(requested) ? Math.floor(requested) : 20,
      RAG_BATCH_MAX_PER_RUN,
      rate.rpdRemaining,
    ),
  )

  const dryRun = Boolean(body.dryRun)

  const accessToken =
    typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice('Bearer '.length)
      : null

  let email: string | null = null
  try {
    const { resolveSupabaseUser } = await import('./auth.js')
    const user = await resolveSupabaseUser(req)
    if (user?.email) email = user.email
  } catch {
    // ignore
  }

  job.id = crypto.randomUUID()
  job.logs = []
  job.selectedModel = labelModel
  runner = runBatch({
    dryRun,
    limit,
    labelModel,
    accessToken,
    userEmail: email,
  }).finally(() => {
    runner = null
  })

  res.status(202).json({
    ok: true,
    message: `Batch accepted for up to ${limit} model(s) via ${provider}/${labelModel}`,
    state: publicState(labelModel),
  })
}

export async function ragBatchCancelHandler(_req: Request, res: Response): Promise<void> {
  if (job.status !== 'running') {
    res.status(400).json({ error: 'No running batch to cancel', state: publicState() })
    return
  }
  abortRequested = true
  job.status = 'cancelling'
  pushLog('warn', 'Cancel requested… will stop after the current model')
  res.json({ ok: true, state: publicState() })
}

/**
 * Sync/refresh local rate-limit view for the selected OpenRouter model.
 * OpenRouter is credit-based; we show local safety caps (optionally live headers if present).
 */
export async function ragBatchSyncLimitsHandler(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as { model?: string }
  const modelId = resolveLabelModel(body.model)
  const provider = providerForModel(modelId)

  if (!isProviderConfigured(provider)) {
    res.status(503).json({
      error: providerKeyError(provider),
      state: publicState(modelId),
    })
    return
  }

  const [usage] = await Promise.all([fetchOpenRouterUsage(true), fetchOpenRouterModelPricing(true)])
  const balance =
    usage?.balanceRemaining != null ? `$${usage.balanceRemaining.toFixed(4)} left` : 'balance n/a'
  const today =
    usage != null ? `$${usage.usageDaily.toFixed(4)} today (this key)` : 'usage n/a'

  res.json({
    ok: true,
    message: `Synced OpenRouter usage for ${modelId} · ${balance} · ${today}`,
    state: publicState(modelId),
  })
}
