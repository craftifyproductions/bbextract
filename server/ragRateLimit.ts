import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  LOGS_DIR,
  OPENROUTER_LABEL_RPD,
  OPENROUTER_LABEL_RPM,
  OPENROUTER_LABEL_TPM,
} from './config.js'

export type LabelProvider = 'openrouter' | 'nvidia'

export interface ModelRateCaps {
  rpm: number
  tpm: number
  rpd: number
  source: 'openrouter-local-caps' | 'nvidia-local-caps'
}

interface TimedTokens {
  at: number
  tokens: number
}

interface LiveProviderSnapshot {
  rpmLimit?: number
  tpmLimit: number
  rpdLimit: number
  tpmRemaining: number
  rpdRemaining: number
  resetRequests?: string
  resetTokens?: string
  updatedAt: string
}

interface ModelDayQuota {
  requests: number
  tokens: number
  live?: LiveProviderSnapshot
}

interface QuotaFile {
  date: string
  models: Record<string, ModelDayQuota>
}

interface ModelWindowState {
  requestTimes: number[]
  tokenWindow: TimedTokens[]
  chain: Promise<void>
}

/** Local safety caps for OpenRouter vision labeling (credit-based accounts vary). */
export const MODEL_RATE_CAPS: Record<string, ModelRateCaps> = {
  'xiaomi/mimo-v2.5': { rpm: 20, tpm: 200_000, rpd: 2_000, source: 'openrouter-local-caps' },
  'minimax/minimax-m3': { rpm: 20, tpm: 200_000, rpd: 2_000, source: 'openrouter-local-caps' },
  'stepfun/step-3.7-flash': { rpm: 25, tpm: 200_000, rpd: 2_500, source: 'openrouter-local-caps' },
  'google/gemini-3.6-flash': { rpm: 20, tpm: 200_000, rpd: 2_000, source: 'openrouter-local-caps' },
  'google/gemini-3.5-flash': { rpm: 20, tpm: 200_000, rpd: 2_000, source: 'openrouter-local-caps' },
  'google/gemini-2.5-pro': { rpm: 15, tpm: 150_000, rpd: 1_000, source: 'openrouter-local-caps' },
  'anthropic/claude-sonnet-5': { rpm: 15, tpm: 150_000, rpd: 1_000, source: 'openrouter-local-caps' },
  'anthropic/claude-sonnet-4.6': { rpm: 15, tpm: 150_000, rpd: 1_000, source: 'openrouter-local-caps' },
  'openai/gpt-5.4': { rpm: 15, tpm: 150_000, rpd: 1_000, source: 'openrouter-local-caps' },
  'openai/gpt-4.1': { rpm: 20, tpm: 200_000, rpd: 1_500, source: 'openrouter-local-caps' },
  'openai/gpt-4.1-mini': { rpm: 30, tpm: 250_000, rpd: 3_000, source: 'openrouter-local-caps' },
  'openai/gpt-4o': { rpm: 20, tpm: 200_000, rpd: 1_500, source: 'openrouter-local-caps' },
  'qwen/qwen3-vl-235b-a22b-instruct': {
    rpm: 20,
    tpm: 200_000,
    rpd: 2_000,
    source: 'openrouter-local-caps',
  },
  'qwen/qwen2.5-vl-72b-instruct': {
    rpm: 25,
    tpm: 200_000,
    rpd: 2_500,
    source: 'openrouter-local-caps',
  },
  'meta-llama/llama-4-maverick': {
    rpm: 25,
    tpm: 200_000,
    rpd: 2_500,
    source: 'openrouter-local-caps',
  },
  'meta-llama/llama-4-scout': { rpm: 30, tpm: 250_000, rpd: 3_000, source: 'openrouter-local-caps' },

  // NVIDIA NIM direct (faster than OpenRouter free queues)
  'nvidia/nemotron-nano-12b-v2-vl': {
    rpm: 40,
    tpm: 100_000,
    rpd: 1_000,
    source: 'nvidia-local-caps',
  },
  'nvidia/llama-3.1-nemotron-nano-vl-8b-v1': {
    rpm: 40,
    tpm: 100_000,
    rpd: 1_000,
    source: 'nvidia-local-caps',
  },
  'meta/llama-4-scout-17b-16e-instruct': {
    rpm: 40,
    tpm: 100_000,
    rpd: 1_000,
    source: 'nvidia-local-caps',
  },
  'google/gemma-3-27b-it': { rpm: 40, tpm: 100_000, rpd: 1_000, source: 'nvidia-local-caps' },

  // Embedding models (OpenRouter + NVIDIA NIM)
  'openai/text-embedding-3-small': {
    rpm: 60,
    tpm: 500_000,
    rpd: 5_000,
    source: 'openrouter-local-caps',
  },
  'qwen/qwen3-embedding-8b': { rpm: 40, tpm: 300_000, rpd: 3_000, source: 'openrouter-local-caps' },
  'qwen/qwen3-embedding-4b': { rpm: 40, tpm: 300_000, rpd: 3_000, source: 'openrouter-local-caps' },
  'voyageai/voyage-4-lite': { rpm: 40, tpm: 300_000, rpd: 3_000, source: 'openrouter-local-caps' },
  'perplexity/pplx-embed-v1-0.6b': {
    rpm: 40,
    tpm: 300_000,
    rpd: 3_000,
    source: 'openrouter-local-caps',
  },
  'baai/bge-m3': { rpm: 40, tpm: 300_000, rpd: 3_000, source: 'openrouter-local-caps' },
  'nvidia/nemotron-3-embed-1b:free': {
    rpm: 20,
    tpm: 100_000,
    rpd: 500,
    source: 'openrouter-local-caps',
  },
  'nvidia/llama-nemotron-embed-vl-1b-v2:free': {
    rpm: 20,
    tpm: 100_000,
    rpd: 500,
    source: 'openrouter-local-caps',
  },
  'nvidia/nv-embedqa-e5-v5': { rpm: 40, tpm: 100_000, rpd: 1_000, source: 'nvidia-local-caps' },
  'nvidia/llama-3.2-nv-embedqa-1b-v2': {
    rpm: 40,
    tpm: 100_000,
    rpd: 1_000,
    source: 'nvidia-local-caps',
  },
  'nvidia/nv-embedqa-mistral-7b-v2': {
    rpm: 30,
    tpm: 80_000,
    rpd: 800,
    source: 'nvidia-local-caps',
  },
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function quotaPath(): string {
  return join(LOGS_DIR, 'rag-model-quota.json')
}

function readQuotaFile(): QuotaFile {
  const empty: QuotaFile = { date: todayUtc(), models: {} }
  try {
    if (!existsSync(quotaPath())) return empty
    const raw = JSON.parse(readFileSync(quotaPath(), 'utf8')) as QuotaFile
    if (raw.date !== todayUtc()) return empty
    return { date: raw.date, models: raw.models ?? {} }
  } catch {
    return empty
  }
}

function writeQuotaFile(file: QuotaFile): void {
  if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true })
  writeFileSync(quotaPath(), `${JSON.stringify(file, null, 2)}\n`, 'utf8')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseResetToMs(value: string | null): number | null {
  if (!value) return null
  const minutes = value.match(/(\d+(?:\.\d+)?)m/)
  const seconds = value.match(/(\d+(?:\.\d+)?)s/)
  let ms = 0
  if (minutes) ms += Number(minutes[1]) * 60_000
  if (seconds) ms += Number(seconds[1]) * 1000
  return ms > 0 ? ms : null
}

export function getModelRateCaps(modelId: string): ModelRateCaps {
  return (
    MODEL_RATE_CAPS[modelId] ?? {
      rpm: OPENROUTER_LABEL_RPM || 20,
      tpm: OPENROUTER_LABEL_TPM || 200_000,
      rpd: OPENROUTER_LABEL_RPD || 2_000,
      source: 'openrouter-local-caps',
    }
  )
}

/**
 * Per-model rate limiter for OpenRouter vision labeling (local safety caps).
 */
export class ModelLabelRateLimiter {
  private readonly windows = new Map<string, ModelWindowState>()

  private windowFor(modelId: string): ModelWindowState {
    let state = this.windows.get(modelId)
    if (!state) {
      state = { requestTimes: [], tokenWindow: [], chain: Promise.resolve() }
      this.windows.set(modelId, state)
    }
    return state
  }

  private prune(state: ModelWindowState, now: number): void {
    const cutoff = now - 60_000
    while (state.requestTimes.length > 0 && state.requestTimes[0]! < cutoff) {
      state.requestTimes.shift()
    }
    while (state.tokenWindow.length > 0 && state.tokenWindow[0]!.at < cutoff) {
      state.tokenWindow.shift()
    }
  }

  private estimateLiveTpmRemaining(
    live: LiveProviderSnapshot,
    localTokensSinceSync: number,
    now: number,
  ): number {
    const syncedAt = new Date(live.updatedAt).getTime()
    const ageMs = Math.max(0, now - syncedAt)
    const resetMs = parseResetToMs(live.resetTokens ?? null) ?? 60_000
    const deficit = Math.max(0, live.tpmLimit - live.tpmRemaining)
    const recovered = Math.min(deficit, Math.floor((ageMs / Math.max(1, resetMs)) * deficit))
    return Math.max(
      0,
      Math.min(live.tpmLimit, live.tpmRemaining + recovered - localTokensSinceSync),
    )
  }

  getStatus(modelId: string, estimatedNextTokens = 0) {
    const now = Date.now()
    const state = this.windowFor(modelId)
    this.prune(state, now)
    const caps = getModelRateCaps(modelId)
    const file = readQuotaFile()
    const day = file.models[modelId] ?? { requests: 0, tokens: 0 }
    // OpenRouter often returns x-ratelimit-* as 0; ignore unusable live snapshots.
    const live =
      day.live &&
      Number(day.live.rpdLimit) > 0 &&
      Number(day.live.tpmLimit) > 0 &&
      Number(day.live.rpdRemaining) >= 0
        ? day.live
        : null
    const liveFresh =
      live && Date.now() - new Date(live.updatedAt).getTime() < 5 * 60_000 ? live : null

    const rpmLimit = caps.rpm
    const tpmLimit = liveFresh?.tpmLimit ?? caps.tpm
    const rpdLimit = liveFresh?.rpdLimit ?? caps.rpd

    const rpmUsed = state.requestTimes.length
    const tpmUsedLocal = state.tokenWindow.reduce((sum, row) => sum + row.tokens, 0)
    const rpdUsedLocal = day.requests
    const syncedAt = liveFresh ? new Date(liveFresh.updatedAt).getTime() : 0
    const localTokensSinceSync = liveFresh
      ? state.tokenWindow
          .filter((row) => row.at >= syncedAt)
          .reduce((sum, row) => sum + row.tokens, 0)
      : 0

    const tpmRemaining = liveFresh
      ? this.estimateLiveTpmRemaining(liveFresh, localTokensSinceSync, now)
      : Math.max(0, tpmLimit - tpmUsedLocal)
    const rpdRemaining = liveFresh
      ? Math.max(0, liveFresh.rpdRemaining)
      : Math.max(0, rpdLimit - rpdUsedLocal)
    const rpmRemaining = Math.max(0, rpmLimit - rpmUsed)

    const tpmUsed = Math.max(0, tpmLimit - tpmRemaining)
    const rpdUsed = Math.max(0, rpdLimit - rpdRemaining)

    const minGapMs = Math.ceil(60_000 / Math.max(1, rpmLimit))
    const last = state.requestTimes[state.requestTimes.length - 1]
    let waitMs = 0
    if (rpmUsed >= rpmLimit && state.requestTimes[0]) {
      waitMs = Math.max(waitMs, state.requestTimes[0] + 60_000 - now)
    }
    if (tpmRemaining < estimatedNextTokens) {
      if (liveFresh?.resetTokens) {
        const resetMs = parseResetToMs(liveFresh.resetTokens)
        const ageMs = Math.max(0, now - syncedAt)
        if (resetMs != null) waitMs = Math.max(waitMs, Math.max(0, resetMs - ageMs))
      } else if (state.tokenWindow[0]) {
        waitMs = Math.max(waitMs, state.tokenWindow[0].at + 60_000 - now)
      }
    }
    if (last != null) waitMs = Math.max(waitMs, last + minGapMs - now)
    waitMs = Math.max(0, waitMs)

    const oldestRequestAt = state.requestTimes[0] ?? null
    const rpmResetsInMs =
      oldestRequestAt != null && rpmUsed > 0
        ? Math.max(0, oldestRequestAt + 60_000 - now)
        : 0
    const tpmResetsInMs = liveFresh?.resetTokens
      ? Math.max(0, (parseResetToMs(liveFresh.resetTokens) ?? 60_000) - Math.max(0, now - syncedAt))
      : state.tokenWindow[0]
        ? Math.max(0, state.tokenWindow[0].at + 60_000 - now)
        : 0

    return {
      modelId,
      provider: 'openrouter' as const,
      rpmLimit,
      tpmLimit,
      rpdLimit,
      rpmUsed,
      tpmUsed,
      rpdUsed,
      rpmRemaining,
      tpmRemaining,
      rpdRemaining,
      rpmPercent: Math.min(100, Math.round((rpmUsed / Math.max(1, rpmLimit)) * 100)),
      tpmPercent: Math.min(100, Math.round((tpmUsed / Math.max(1, tpmLimit)) * 100)),
      rpdPercent: Math.min(100, Math.round((rpdUsed / Math.max(1, rpdLimit)) * 100)),
      nextSlotMs: waitMs,
      nextSlotSeconds: Math.ceil(waitMs / 1000),
      rpmResetsInSeconds: Math.ceil(rpmResetsInMs / 1000),
      tpmResetsInSeconds: Math.ceil(tpmResetsInMs / 1000),
      canSendNow: rpdRemaining > 0 && waitMs <= 0,
      date: file.date,
      updatedAt: liveFresh?.updatedAt ?? new Date(now).toISOString(),
      source: liveFresh ? ('provider-headers' as const) : ('local-tracker' as const),
      note: '',
      publishedCaps: caps,
      liveSynced: Boolean(liveFresh),
    }
  }

  ingestLiveHeaders(modelId: string, headers: Headers): void {
    const rpdLimit = Number(headers.get('x-ratelimit-limit-requests'))
    const rpdRemaining = Number(headers.get('x-ratelimit-remaining-requests'))
    const tpmLimit = Number(headers.get('x-ratelimit-limit-tokens'))
    const tpmRemaining = Number(headers.get('x-ratelimit-remaining-tokens'))

    // Require real positive limits. OpenRouter frequently sends 0s (credit-based),
    // which must not overwrite local safety caps.
    if (
      !Number.isFinite(rpdLimit) ||
      !Number.isFinite(rpdRemaining) ||
      !Number.isFinite(tpmLimit) ||
      !Number.isFinite(tpmRemaining) ||
      rpdLimit <= 0 ||
      tpmLimit <= 0
    ) {
      return
    }

    const file = readQuotaFile()
    const day = file.models[modelId] ?? { requests: 0, tokens: 0 }
    day.live = {
      rpmLimit: rpdLimit,
      tpmLimit,
      rpdLimit,
      tpmRemaining: Math.max(0, tpmRemaining),
      rpdRemaining: Math.max(0, rpdRemaining),
      resetRequests: headers.get('x-ratelimit-reset-requests') ?? undefined,
      resetTokens: headers.get('x-ratelimit-reset-tokens') ?? undefined,
      updatedAt: new Date().toISOString(),
    }
    file.models[modelId] = day
    writeQuotaFile(file)
  }

  /** @deprecated Use ingestLiveHeaders */
  ingestGroqHeaders(modelId: string, headers: Headers): void {
    this.ingestLiveHeaders(modelId, headers)
  }

  schedule<T>(modelId: string, estimatedTokens: number, fn: () => Promise<T>): Promise<T> {
    const state = this.windowFor(modelId)
    const run = state.chain.then(async () => {
      for (;;) {
        const status = this.getStatus(modelId, estimatedTokens)
        if (status.rpdRemaining <= 0) {
          throw new Error(
            `Daily OpenRouter label limit reached for ${modelId} (${status.rpdLimit} RPD).`,
          )
        }
        if (status.nextSlotMs <= 0) break
        await sleep(Math.min(status.nextSlotMs + 25, 15_000))
      }

      const now = Date.now()
      state.requestTimes.push(now)
      state.tokenWindow.push({ at: now, tokens: Math.max(1, estimatedTokens) })

      const file = readQuotaFile()
      const day = file.models[modelId] ?? { requests: 0, tokens: 0 }
      day.requests += 1
      day.tokens += Math.max(1, estimatedTokens)
      file.models[modelId] = day
      writeQuotaFile(file)

      return fn()
    })

    state.chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

export const modelLabelRateLimiter = new ModelLabelRateLimiter()

export function estimateLabelTokens(promptChars: number, hasImage: boolean): number {
  const textTokens = Math.ceil(promptChars / 4)
  const imageTokens = hasImage ? 1_200 : 0
  return textTokens + imageTokens + 900
}
