import { ApiError } from './api'

export interface Generate2DRequest {
  prompt: string
  negativePrompt?: string
  assetType: 'ui' | 'icon' | 'sprite' | 'texture' | 'concept'
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
  artStyle: 'flat-ui' | 'pixel' | 'illustration' | 'game-asset' | 'wireframe-ui'
  model?: string
  referenceImageName?: string
  referenceImageDataUrl?: string
  /** When true, treat reference image + refinePrompt as an edit pass. */
  refine?: boolean
  refinePrompt?: string
}

export interface Generate2DProgressLog {
  stage: string
  message: string
  level: 'info' | 'warn' | 'error' | 'debug'
}

export interface SelectableImageModel {
  id: string
  label: string
  description: string
  tier: 'fast' | 'balanced' | 'quality'
}

export interface Generate2DResponse {
  title?: string
  imageDataUrl?: string
  mimeType?: string
  note?: string
  error?: string
  configured?: boolean
  model?: string
  attempts?: string[]
  settings?: {
    assetType: string
    aspectRatio: string
    artStyle: string
    model?: string
  }
  progressLogs?: Generate2DProgressLog[]
}

export interface Generate2DStatus {
  configured: boolean
  geminiConfigured?: boolean
  cloudflareWorkerConfigured?: boolean
  model?: string
  models?: string[]
  selectableModels?: SelectableImageModel[]
  providers?: {
    cloudflareWorker?: boolean
    pollinations?: boolean
    gemini?: boolean
  }
}

export async function getGenerate2DStatus(): Promise<Generate2DStatus> {
  const response = await fetch('/api/generate/2d/status', {
    credentials: 'include',
  })
  if (!response.ok) {
    throw new ApiError(`Status check failed (${response.status})`, response.status)
  }
  return response.json() as Promise<Generate2DStatus>
}

export async function generate2DAsset(
  payload: Generate2DRequest,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<Generate2DResponse> {
  const timeoutMs = options?.timeoutMs ?? 90_000
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  const onAbort = () => controller.abort()
  options?.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const response = await fetch('/api/generate/2d', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    let body: Generate2DResponse = {}
    try {
      body = (await response.json()) as Generate2DResponse
    } catch {
      // ignore
    }

    if (!response.ok) {
      const error = new ApiError(body.error || `Generation failed (${response.status})`, response.status)
      ;(error as ApiError & { progressLogs?: Generate2DProgressLog[] }).progressLogs = body.progressLogs
      throw error
    }

    return body
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(
        'Generation timed out waiting for Gemini. Check quota/billing, or try a faster model.',
        408,
      )
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
    options?.signal?.removeEventListener('abort', onAbort)
  }
}
