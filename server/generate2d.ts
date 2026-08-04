import type { Request, Response } from 'express'
import { GoogleGenAI } from '@google/genai'
import {
  CF_WORKER_IMAGE_API_KEY,
  CF_WORKER_IMAGE_URL,
  GEMINI_API_KEY,
  GEMINI_IMAGE_MODEL,
  isCloudflareWorkerImageConfigured,
} from './config.js'

type AssetType = 'ui' | 'icon' | 'sprite' | 'texture' | 'concept'
type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
type ArtStyle = 'flat-ui' | 'pixel' | 'illustration' | 'game-asset' | 'wireframe-ui'

const ASSET_TYPES: readonly AssetType[] = ['ui', 'icon', 'sprite', 'texture', 'concept']
const ASPECT_RATIOS: readonly AspectRatio[] = ['1:1', '16:9', '9:16', '4:3', '3:4']
const ART_STYLES: readonly ArtStyle[] = [
  'flat-ui',
  'pixel',
  'illustration',
  'game-asset',
  'wireframe-ui',
]

interface Generate2DBody {
  prompt?: string
  negativePrompt?: string
  assetType?: AssetType
  aspectRatio?: AspectRatio
  artStyle?: ArtStyle
  model?: string
  referenceImageName?: string
  referenceImageDataUrl?: string
  refine?: boolean
  refinePrompt?: string
}

function isAssetType(value: unknown): value is AssetType {
  return typeof value === 'string' && (ASSET_TYPES as readonly string[]).includes(value)
}

function isAspectRatio(value: unknown): value is AspectRatio {
  return typeof value === 'string' && (ASPECT_RATIOS as readonly string[]).includes(value)
}

function isArtStyle(value: unknown): value is ArtStyle {
  return typeof value === 'string' && (ART_STYLES as readonly string[]).includes(value)
}

export interface SelectableModel {
  id: string
  label: string
  description: string
  tier: 'fast' | 'balanced' | 'quality'
}

interface ProgressLog {
  stage: string
  message: string
  level: 'info' | 'warn' | 'error' | 'debug'
}

const ASPECT_SIZE: Record<AspectRatio, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '4:3': { width: 1024, height: 768 },
  '3:4': { width: 768, height: 1024 },
}

const POLLINATIONS_MODEL_ID = 'pollinations-flux'
const CLOUDFLARE_WORKER_MODEL_ID = 'cloudflare-worker'

const POLLINATIONS_BACKEND: Record<string, string> = {
  'pollinations-flux': 'flux',
  'pollinations-zimage': 'zimage',
  'pollinations-klein': 'klein',
}

/** Image-capable models shown in the Generate → 2D model picker. */
export const SELECTABLE_IMAGE_MODELS: SelectableModel[] = [
  {
    id: CLOUDFLARE_WORKER_MODEL_ID,
    label: 'Free · Cloudflare Worker',
    description: 'Your Workers image API · recommended free path',
    tier: 'fast',
  },
  {
    id: 'gemini-2.5-flash-image',
    label: 'Nano Banana',
    description: 'Gemini 2.5 Flash Image · AI Studio Nano Banana',
    tier: 'fast',
  },
  {
    id: 'nano-banana-pro-preview',
    label: 'Nano Banana Pro Preview',
    description: 'Official nano-banana-pro-preview model id',
    tier: 'quality',
  },
  {
    id: 'gemini-2.5-flash-image-preview',
    label: 'Nano Banana Preview',
    description: 'Legacy preview id (may 404 on some keys)',
    tier: 'fast',
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    label: 'Nano Banana 2 Lite',
    description: 'Gemini 3.1 Flash Lite Image',
    tier: 'fast',
  },
  {
    id: 'gemini-3.1-flash-image',
    label: 'Nano Banana 2',
    description: 'Gemini 3.1 Flash Image · balanced quality',
    tier: 'balanced',
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    label: 'Nano Banana 2 Preview',
    description: 'Gemini 3.1 Flash Image Preview',
    tier: 'balanced',
  },
  {
    id: 'gemini-3-pro-image',
    label: 'Nano Banana Pro',
    description: 'Gemini 3 Pro Image · higher quality',
    tier: 'quality',
  },
  {
    id: 'gemini-3-pro-image-preview',
    label: 'Nano Banana Pro Preview',
    description: 'Gemini 3 Pro Image Preview · highest quality',
    tier: 'quality',
  },
  {
    id: 'pollinations-flux',
    label: 'Free · Pollinations Flux',
    description: 'Fallback if Gemini quota fails · lower quality',
    tier: 'fast',
  },
  {
    id: 'pollinations-zimage',
    label: 'Free · Pollinations Z-Image',
    description: 'Free alternative style',
    tier: 'fast',
  },
  {
    id: 'pollinations-klein',
    label: 'Free · Pollinations Klein',
    description: 'Free fast model',
    tier: 'fast',
  },
]

const GEMINI_MODEL_IDS = new Set(
  SELECTABLE_IMAGE_MODELS.filter(
    (model) => model.id.startsWith('gemini-') || model.id.startsWith('nano-banana'),
  ).map((model) => model.id),
)

const MODEL_FALLBACKS = [
  CLOUDFLARE_WORKER_MODEL_ID,
  POLLINATIONS_MODEL_ID,
  GEMINI_IMAGE_MODEL,
  ...SELECTABLE_IMAGE_MODELS.map((model) => model.id),
].filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index)

function normalizeModelId(value: string | undefined): string | null {
  if (!value?.trim()) return null
  return value.trim().replace(/^models\//, '')
}

function isPollinationsModel(modelId: string | null | undefined): boolean {
  return Boolean(modelId?.startsWith('pollinations-'))
}

function isCloudflareWorkerModel(modelId: string | null | undefined): boolean {
  return modelId === CLOUDFLARE_WORKER_MODEL_ID
}

function resolveModelChain(preferred?: string): string[] {
  const selected = normalizeModelId(preferred)
  const chain: string[] = []

  if (selected && GEMINI_MODEL_IDS.has(selected)) chain.push(selected)

  // Keep Gemini fallbacks short so a quota/rate-limit issue fails fast.
  // Prefer the official Nano Banana preview model from AI Studio docs.
  const shortFallbacks = [
    'gemini-2.5-flash-image',
    'gemini-3.1-flash-lite-image',
    'gemini-3.1-flash-image',
  ]
  for (const model of shortFallbacks) {
    if (!chain.includes(model) && GEMINI_MODEL_IDS.has(model)) chain.push(model)
  }
  return chain
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseRetryMs(message: string): number | null {
  const match = /retry in ([0-9.]+)s/i.exec(message)
  if (!match?.[1]) return null
  // Keep waits short so the UI doesn't look stuck for a long time.
  return Math.min(8000, Math.ceil(Number(match[1]) * 1000) + 250)
}

function isHardQuotaError(message: string): boolean {
  return /limit:\s*0|quota exceeded|exceeded your current quota|billing/i.test(message)
}

function formatGeminiError(message: string, status?: number): string {
  if (isHardQuotaError(message)) {
    return [
      'Gemini image quota unavailable for this API key/project.',
      'In Google AI Studio, enable billing for the Gemini API (image models often require a paid plan).',
      'Then retry generation.',
      status ? `(HTTP ${status})` : '',
      message.split('\n')[0],
    ]
      .filter(Boolean)
      .join(' ')
  }
  return message
}

function isConfigured(): boolean {
  return Boolean(GEMINI_API_KEY && GEMINI_API_KEY.trim().length > 0)
}

function pushProgress(logs: ProgressLog[], stage: string, message: string, level: ProgressLog['level'] = 'info') {
  logs.push({ stage, message, level })
}

function buildPrompt(body: Generate2DBody): string {
  const assetType = body.assetType ?? 'ui'
  const artStyle = body.artStyle ?? 'flat-ui'
  const aspectRatio = body.aspectRatio ?? '1:1'
  const size = ASPECT_SIZE[aspectRatio]
  const clarifiedSubject = clarifySubjectForAsset(body.prompt?.trim() || '', assetType)

  const styleHints: Record<ArtStyle, string> = {
    'flat-ui':
      'clean flat UI design, crisp vector shapes, restrained shadows, modern product interface, high clarity',
    pixel:
      'pixel art, limited color palette, crisp pixels, no anti-alias blur, game-ready sprite presentation',
    illustration:
      'polished digital illustration, clear silhouette, strong composition, production concept quality',
    'game-asset':
      'game-ready 2D asset, readable silhouette, balanced contrast, suitable for game UI or atlas packing',
    'wireframe-ui':
      'UI wireframe, grayscale linework, layout-focused structure, minimal fill, annotation-friendly',
  }

  const typeHints: Record<AssetType, string> = {
    ui: 'a complete UI screen or panel mockup for a game/app (buttons, panels, readable hierarchy)',
    icon: 'a single centered icon with clean edges and simple background',
    sprite: 'a centered game sprite (character or object) with clear outline and usable silhouette',
    texture: 'a texture surface that feels tileable or material-ready, even lighting',
    concept: 'concept art suitable as production reference, clear subject focus',
  }

  const refinePrompt = body.refinePrompt?.trim()
  const isRefine = Boolean(body.refine && refinePrompt)

  const parts = isRefine
    ? [
        `Refine the attached/base image. Do not ignore the current image — edit it.`,
        `Asset type: ${typeHints[assetType]}.`,
        `Art style: ${styleHints[artStyle]}.`,
        `Canvas aspect ratio must stay ${aspectRatio} (about ${size.width}x${size.height}).`,
        `Original concept: ${clarifiedSubject}`,
        `Refine instructions: ${refinePrompt}`,
        'Keep the same subject, layout, and overall identity unless the refine instructions ask to change them.',
        'Apply only the requested changes with a clean, production-usable result.',
      ]
    : [
        `Generate one high-quality image of: ${clarifiedSubject}`,
        `Asset type: ${typeHints[assetType]}.`,
        `Art style: ${styleHints[artStyle]}.`,
        `Canvas aspect ratio must be ${aspectRatio} (about ${size.width}x${size.height}).`,
        'The subject above is mandatory — do not substitute a different object or scene.',
      ]

  if (body.referenceImageDataUrl || body.referenceImageName) {
    parts.push(
      isRefine
        ? 'CRITICAL: The attached image is the current version to refine. Preserve identity, colors, silhouette, and layout unless the refine instructions explicitly change them.'
        : [
            'CRITICAL: An image is attached as the visual reference.',
            'Match the reference closely for subject identity, colors, shapes, silhouette, materials, and composition.',
            'Do not invent a different subject. Only adapt presentation to the selected asset type and art style.',
            'Treat the reference as the primary source of truth over a vague text prompt.',
          ].join(' '),
    )
  }
  parts.push(`Strictly avoid: ${buildNegativePrompt(body)}.`)

  parts.push(
    'Do not add watermarks, logos, or random captions.',
    'Follow the selected asset type, art style, and aspect ratio exactly — they override vague prompt wording.',
    'Prefer clean, production-usable output matching the selected asset type and style.',
    ANTI_PAINT + '.',
  )

  return parts.join('\n')
}

const STYLE_VISUAL: Record<ArtStyle, string> = {
  'flat-ui':
    'clean flat vector UI, solid flat colors, sharp geometric shapes, minimal soft shading, product UI kit style, Adobe Illustrator look',
  pixel: 'pixel art, limited color palette, crisp pixels, no blur, no anti-alias smear, retro game sprite fidelity',
  illustration: 'clean digital illustration, hard edges, controlled cel shading, not painterly',
  'game-asset': 'production game asset, hard edges, solid fills, readable silhouette, atlas-ready',
  'wireframe-ui': 'UI wireframe only, grayscale linework, layout structure, no filled paint texture',
}

const TYPE_VISUAL: Record<AssetType, string> = {
  ui: 'complete game/app UI screen or panel mockup with clear hierarchy, buttons and panels',
  icon: 'single centered icon, simple solid background, app-icon composition, no scene background',
  sprite: 'single centered game sprite character or object, clear outline, isolated subject',
  texture: 'seamless tileable texture surface, even lighting, material close-up',
  concept: 'production concept design, clear subject focus, controlled digital style',
}

const ANTI_PAINT =
  'no watercolor, no oil painting, no acrylic, no impressionism, no soft brush strokes, no canvas grain, no painterly look, no sketch wash, no traditional media'

/**
 * Clarify ambiguous tool-icon phrases free models often misread
 * (e.g. "eyedropper" → eye + water drop instead of a pipette tool).
 */
function clarifySubjectForAsset(userPrompt: string, assetType: AssetType): string {
  const raw = userPrompt.trim()
  if (!raw) return 'game asset'
  if (assetType !== 'icon' && assetType !== 'ui') return raw

  const lower = raw.toLowerCase()
  // Prefer a concrete visual rewrite over the ambiguous word alone.
  if (/\beye\s*-?\s*dropper\b|\beyedropper\b|\bcolour\s*picker\b|\bcolor\s*picker\b|\bpipette\b/i.test(lower)) {
    return [
      'flat 2D vector UI icon of a color-picker pipette tool',
      'orange or black rubber squeeze bulb on top',
      'thin vertical tube with a pointed tip at the bottom',
      'Photoshop / Figma eyedropper toolbar style',
      'centered single icon on a plain light background',
      'not a human eye, not a water droplet, not a building or scene',
    ].join(', ')
  }
  if (/\bcursor\b|\bpointer\b/i.test(lower)) {
    return `${raw}, flat 2D mouse pointer arrow cursor UI icon, centered`
  }
  if (/\bbrush\b/i.test(lower)) {
    return `${raw}, flat 2D digital paintbrush tool UI icon, centered`
  }
  if (/\beraser\b/i.test(lower)) {
    return `${raw}, flat 2D eraser tool UI icon, centered`
  }
  return raw
}

/** Exact flat SVG icons for common UI tools — free diffusion models often invent the wrong object. */
function tryBuildDeterministicFlatIcon(body: Generate2DBody): {
  imageDataUrl: string
  label: string
} | null {
  const assetType = body.assetType ?? 'ui'
  const artStyle = body.artStyle ?? 'flat-ui'
  const prompt = (body.prompt ?? '').toLowerCase()
  if (assetType !== 'icon') return null
  if (body.referenceImageDataUrl || body.refine) return null
  if (artStyle === 'pixel' || artStyle === 'illustration') return null

  const size = 1024
  const bg = '#e8e8ec'
  const stroke = artStyle === 'wireframe-ui' ? '#9ca3af' : '#1f2937'
  const accent = artStyle === 'wireframe-ui' ? '#d1d5db' : '#f97316'
  const tube = artStyle === 'wireframe-ui' ? '#f3f4f6' : '#f8fafc'
  const fill = artStyle === 'wireframe-ui' ? 'none' : accent

  let svg: string | null = null
  let label: string | null = null

  if (/\beye\s*-?\s*dropper\b|\beyedropper\b|\bpipette\b|\bcolou?r\s*picker\b/.test(prompt)) {
    label = 'eyedropper'
    // Classic toolbar pipette: bulb on top, shaft, pointed tip, small drop.
    svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <rect width="128" height="128" fill="${bg}"/>
  <g transform="translate(64 64) rotate(-35) translate(-64 -64)">
    <path d="M52 18c0-6 5-12 12-12s12 6 12 12v10H52V18z" fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/>
    <rect x="56" y="28" width="16" height="10" rx="2" fill="${tube}" stroke="${stroke}" stroke-width="4"/>
    <rect x="58" y="38" width="12" height="46" rx="3" fill="${tube}" stroke="${stroke}" stroke-width="4"/>
    <path d="M58 84h12l-4 18h-4l-4-18z" fill="${tube}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/>
    <circle cx="64" cy="110" r="5" fill="${fill}" stroke="${stroke}" stroke-width="3"/>
  </g>
</svg>`
  } else if (/\bbrush\b/.test(prompt) && !/\btooth\b/.test(prompt)) {
    label = 'brush'
    svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <rect width="128" height="128" fill="${bg}"/>
  <g transform="translate(64 64) rotate(-40) translate(-64 -64)">
    <rect x="58" y="16" width="12" height="54" rx="3" fill="${tube}" stroke="${stroke}" stroke-width="4"/>
    <path d="M50 70h28c2 0 6 4 6 10v8c0 8-8 16-20 16S44 96 44 88v-8c0-6 4-10 6-10z" fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/>
  </g>
</svg>`
  } else if (/\beraser\b/.test(prompt)) {
    label = 'eraser'
    svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <rect width="128" height="128" fill="${bg}"/>
  <g transform="translate(64 64) rotate(-25) translate(-64 -64)">
    <path d="M34 70l24-36c3-4 8-4 11 0l25 36c3 4 1 10-4 10H38c-5 0-7-6-4-10z" fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M40 80h48v12c0 4-3 8-8 8H48c-5 0-8-4-8-8V80z" fill="${tube}" stroke="${stroke}" stroke-width="4"/>
  </g>
</svg>`
  }

  if (!svg || !label) return null
  return {
    label,
    imageDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
  }
}

/**
 * Subject-first prompt for Pollinations / Cloudflare Worker free APIs.
 * Keep it short — long settings preambles make SD models ignore the subject.
 */
function buildPollinationsPrompt(body: Generate2DBody): string {
  const assetType = (body.assetType ?? 'ui') as AssetType
  const artStyle = (body.artStyle ?? 'flat-ui') as ArtStyle
  const userPrompt = clarifySubjectForAsset(body.prompt?.trim() || 'game asset', assetType)
  const refinePrompt = body.refinePrompt?.trim()
  const negative = body.negativePrompt?.trim()
  const isRefine = Boolean(body.refine && refinePrompt)
  const hasReference = Boolean(body.referenceImageDataUrl)

  const styleCue =
    artStyle === 'pixel'
      ? 'pixel art, crisp pixels'
      : artStyle === 'wireframe-ui'
        ? 'grayscale UI wireframe lines'
        : artStyle === 'illustration'
          ? 'clean digital illustration, hard edges'
          : artStyle === 'game-asset'
            ? 'game-ready 2D asset, hard edges'
            : 'flat vector UI, solid colors, sharp geometric shapes'

  const typeCue =
    assetType === 'icon'
      ? 'single centered app icon, simple solid background, no scene, no environment'
      : assetType === 'sprite'
        ? 'single centered game sprite, clear silhouette'
        : assetType === 'texture'
          ? 'tileable texture surface'
          : assetType === 'concept'
            ? 'production concept design'
            : 'UI screen or panel mockup'

  // Lead with the user's subject — free models weight the beginning of the prompt most.
  const chunks: string[] = isRefine
    ? [
        `edit this image: ${refinePrompt}`,
        `based on: ${userPrompt}`,
        typeCue,
        styleCue,
        'keep the same subject unless refine asks otherwise',
      ]
    : [`${userPrompt}`, typeCue, styleCue, 'crisp digital graphic, high contrast, professional quality']

  if (hasReference) {
    chunks.splice(
      1,
      0,
      'match the attached reference image for subject, colors, and silhouette',
    )
  }

  if (assetType === 'icon' || artStyle === 'flat-ui') {
    chunks.push('simple icon composition only — no buildings, landscapes, characters, or busy backgrounds')
  }
  if (artStyle === 'pixel') {
    chunks.push('visible pixel grid, limited palette')
  }
  if (negative) {
    chunks.push(`avoid: ${negative}`)
  } else if (assetType === 'icon') {
    chunks.push('avoid: photorealism, watercolor, cluttered scene, text watermark')
  }

  return chunks.join(', ')
}

/** Host a reference image publicly so Pollinations can fetch it for img2img. */
async function uploadReferenceImage(dataUrl: string): Promise<string> {
  const parsed = parseDataUrl(dataUrl)
  if (!parsed) {
    throw new Error('Invalid reference image data URL.')
  }

  const buffer = Buffer.from(parsed.data, 'base64')
  if (buffer.byteLength < 32) {
    throw new Error('Reference image is empty.')
  }
  if (buffer.byteLength > 5_500_000) {
    throw new Error('Reference image is too large to upload for img2img (max ~5.5MB).')
  }

  const ext = parsed.mimeType.includes('jpeg') || parsed.mimeType.includes('jpg')
    ? 'jpg'
    : parsed.mimeType.includes('webp')
      ? 'webp'
      : 'png'

  const form = new FormData()
  form.append('reqtype', 'fileupload')
  form.append('fileToUpload', new Blob([buffer], { type: parsed.mimeType }), `reference.${ext}`)

  const response = await fetch('https://catbox.moe/user/api.php', {
    method: 'POST',
    body: form,
  })
  const text = (await response.text()).trim()
  if (!response.ok || !/^https?:\/\//i.test(text)) {
    throw new Error(`Reference upload failed${text ? `: ${text.slice(0, 140)}` : ''}`)
  }
  return text
}

function buildNegativePrompt(body: Generate2DBody): string {
  const extras = body.negativePrompt?.trim()
  const base =
    'watercolor, oil painting, acrylic, impressionist, painterly, brush strokes, canvas texture, blurry, watermark, illegible text, messy background, photo realism when flat UI requested'
  return extras ? `${base}, ${extras}` : base
}

function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl)
  if (!match?.[1] || !match[2]) return null
  return { mimeType: match[1], data: match[2] }
}

/** Placeholder SVG used when no API key is configured. */
function buildPlaceholderDataUrl(body: Generate2DBody): string {
  const aspectRatio = (body.aspectRatio ?? '1:1') as AspectRatio
  const { width, height } = ASPECT_SIZE[aspectRatio]
  const title = (body.prompt ?? '2D asset').slice(0, 48)
  const label = `${body.assetType ?? 'ui'} · ${aspectRatio} · ${body.artStyle ?? 'flat-ui'}`
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a1d23"/>
      <stop offset="100%" stop-color="#2a3140"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect x="8%" y="10%" width="84%" height="80%" rx="18" fill="none" stroke="#4a7fd4" stroke-width="4" stroke-dasharray="12 10"/>
  <text x="50%" y="46%" fill="#e8eaed" font-family="IBM Plex Mono, monospace" font-size="${Math.round(width * 0.035)}" text-anchor="middle">${escapeXml(title)}</text>
  <text x="50%" y="54%" fill="#9aa0a6" font-family="IBM Plex Mono, monospace" font-size="${Math.round(width * 0.028)}" text-anchor="middle">${escapeXml(label)}</text>
  <text x="50%" y="62%" fill="#6b7280" font-family="IBM Plex Mono, monospace" font-size="${Math.round(width * 0.024)}" text-anchor="middle">Gemini key not connected</text>
</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function generate2DStatusHandler(_req: Request, res: Response): void {
  const configuredDefault = normalizeModelId(GEMINI_IMAGE_MODEL)
  const workerReady = isCloudflareWorkerImageConfigured()
  const defaultModel = workerReady
    ? CLOUDFLARE_WORKER_MODEL_ID
    : isConfigured()
      ? SELECTABLE_IMAGE_MODELS.some((model) => model.id === configuredDefault)
        ? configuredDefault
        : 'gemini-2.5-flash-image'
      : POLLINATIONS_MODEL_ID

  res.json({
    configured: true,
    geminiConfigured: isConfigured(),
    cloudflareWorkerConfigured: workerReady,
    model: defaultModel,
    models: MODEL_FALLBACKS,
    selectableModels: SELECTABLE_IMAGE_MODELS,
    providers: {
      cloudflareWorker: workerReady,
      pollinations: true,
      gemini: isConfigured(),
    },
    sdk: '@google/genai',
  })
}

export async function generate2DHandler(req: Request, res: Response): Promise<void> {
  const raw = (req.body ?? {}) as Generate2DBody
  const progressLogs: ProgressLog[] = []

  pushProgress(progressLogs, 'validate', 'Validating generation request…')

  if (raw.assetType != null && !isAssetType(raw.assetType)) {
    pushProgress(progressLogs, 'validate', `Invalid asset type: ${String(raw.assetType)}`, 'error')
    res.status(400).json({
      error: `Invalid assetType. Expected one of: ${ASSET_TYPES.join(', ')}`,
      progressLogs,
    })
    return
  }
  if (raw.aspectRatio != null && !isAspectRatio(raw.aspectRatio)) {
    pushProgress(progressLogs, 'validate', `Invalid aspect ratio: ${String(raw.aspectRatio)}`, 'error')
    res.status(400).json({
      error: `Invalid aspectRatio. Expected one of: ${ASPECT_RATIOS.join(', ')}`,
      progressLogs,
    })
    return
  }
  if (raw.artStyle != null && !isArtStyle(raw.artStyle)) {
    pushProgress(progressLogs, 'validate', `Invalid art style: ${String(raw.artStyle)}`, 'error')
    res.status(400).json({
      error: `Invalid artStyle. Expected one of: ${ART_STYLES.join(', ')}`,
      progressLogs,
    })
    return
  }

  // Normalize settings so every provider path uses the same locked values.
  const assetType: AssetType = isAssetType(raw.assetType) ? raw.assetType : 'ui'
  const aspectRatio: AspectRatio = isAspectRatio(raw.aspectRatio) ? raw.aspectRatio : '1:1'
  const artStyle: ArtStyle = isArtStyle(raw.artStyle) ? raw.artStyle : 'flat-ui'
  const body: Generate2DBody = {
    ...raw,
    assetType,
    aspectRatio,
    artStyle,
  }

  const prompt = body.prompt?.trim()
  const refinePrompt = body.refinePrompt?.trim()
  const isRefine = Boolean(body.refine && refinePrompt)

  if (!prompt && !isRefine) {
    pushProgress(progressLogs, 'validate', 'Prompt is required.', 'error')
    res.status(400).json({ error: 'Prompt is required.', progressLogs })
    return
  }

  if (isRefine && !refinePrompt) {
    pushProgress(progressLogs, 'validate', 'Refine prompt is required.', 'error')
    res.status(400).json({ error: 'Refine prompt is required.', progressLogs })
    return
  }

  const title = isRefine
    ? `Refine: ${(refinePrompt ?? '').slice(0, 34)}`
    : (prompt ?? '').slice(0, 42)
  const selectedModel =
    normalizeModelId(body.model) ??
    (isCloudflareWorkerImageConfigured()
      ? CLOUDFLARE_WORKER_MODEL_ID
      : isConfigured()
        ? normalizeModelId(GEMINI_IMAGE_MODEL) ?? 'gemini-2.5-flash-image'
        : POLLINATIONS_MODEL_ID)
  pushProgress(
    progressLogs,
    'settings',
    `Settings locked — model=${selectedModel ?? 'default'}, type=${assetType}, aspect=${aspectRatio}, style=${artStyle}`,
  )
  if (isRefine) {
    pushProgress(progressLogs, 'refine', `Refine instructions: ${refinePrompt}`)
  }
  if (body.negativePrompt?.trim()) {
    pushProgress(progressLogs, 'settings', `Negative prompt applied (${body.negativePrompt.trim().length} chars)`)
  }
  if (body.referenceImageDataUrl || body.referenceImageName) {
    pushProgress(
      progressLogs,
      'reference',
      `${isRefine ? 'Base image for refine' : 'Reference image'} attached${
        body.referenceImageName ? `: ${body.referenceImageName}` : ''
      }`,
    )
  }

  const geminiPrompt = buildPrompt(body)
  const pollinationsPrompt = buildPollinationsPrompt(body)
  const hasReference = Boolean(body.referenceImageDataUrl)
  pushProgress(
    progressLogs,
    'prompt',
    `Prompt assembled (gemini=${geminiPrompt.length} chars, pollinations=${pollinationsPrompt.length} chars)`,
    'debug',
  )

  let referencePublicUrl: string | null = null
  if (hasReference && body.referenceImageDataUrl) {
    pushProgress(progressLogs, 'reference', 'Preparing reference image for img2img…')
    try {
      referencePublicUrl = await uploadReferenceImage(body.referenceImageDataUrl)
      pushProgress(
        progressLogs,
        'reference',
        `Reference image ready for providers (${referencePublicUrl})`,
      )
    } catch (uploadError) {
      const message =
        uploadError instanceof Error ? uploadError.message : 'Reference upload failed'
      pushProgress(
        progressLogs,
        'reference',
        `${message} — free text-only providers may ignore the reference.`,
        'warn',
      )
    }
  }

  const respondSuccess = (options: {
    imageDataUrl: string
    modelUsed: string
    attempts?: string[]
    note?: string
  }) => {
    pushProgress(progressLogs, 'decode', 'Decoding image payload…')
    pushProgress(progressLogs, 'complete', `Generation complete with ${options.modelUsed}`)
    res.json({
      title,
      imageDataUrl: options.imageDataUrl,
      mimeType: options.imageDataUrl.startsWith('data:image/svg')
        ? 'image/svg+xml'
        : options.imageDataUrl.startsWith('data:image/jpeg')
          ? 'image/jpeg'
          : 'image/png',
      configured: true,
      model: options.modelUsed,
      attempts: options.attempts ?? [options.modelUsed],
      settings: { assetType, aspectRatio, artStyle, model: selectedModel ?? options.modelUsed },
      progressLogs,
      note: options.note ?? `Generated with ${options.modelUsed}`,
    })
  }

  const runPollinationsImg2Img = async (reason: string, attempts: string[] = []) => {
    const modelId = hasReference ? 'pollinations-klein' : POLLINATIONS_MODEL_ID
    pushProgress(
      progressLogs,
      'fallback',
      `${reason} Using Pollinations ${hasReference ? 'img2img (klein)' : 'Flux'}…`,
      'warn',
    )
    if (hasReference && !referencePublicUrl) {
      throw new Error(
        'Reference image could not be uploaded for img2img. Retry, or use a Gemini image model when billing is available.',
      )
    }
    const imageDataUrl = await callPollinationsImage(
      pollinationsPrompt,
      aspectRatio,
      modelId,
      body,
      referencePublicUrl,
    )
    respondSuccess({
      imageDataUrl,
      modelUsed: modelId,
      attempts: [...attempts, modelId],
      note: hasReference
        ? `Generated with Pollinations img2img (reference attached) · ${assetType}/${artStyle}/${aspectRatio}`
        : 'Generated with free Pollinations Flux',
    })
  }

  const runFreeFallback = async (reason: string, attempts: string[] = []) => {
    // Reference images require img2img — Cloudflare Worker endpoint is text-prompt only.
    if (hasReference) {
      await runPollinationsImg2Img(reason, attempts)
      return
    }

    if (isCloudflareWorkerImageConfigured()) {
      pushProgress(progressLogs, 'fallback', `${reason} Using Cloudflare Worker image API…`, 'warn')
      const started = Date.now()
      const imageDataUrl = await callCloudflareWorkerImage(body, pollinationsPrompt)
      pushProgress(
        progressLogs,
        'complete',
        `Cloudflare Worker finished in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      )
      respondSuccess({
        imageDataUrl,
        modelUsed: CLOUDFLARE_WORKER_MODEL_ID,
        attempts: [...attempts, CLOUDFLARE_WORKER_MODEL_ID],
        note: 'Generated with Cloudflare Worker free image API',
      })
      return
    }

    await runPollinationsImg2Img(reason, attempts)
  }

  try {
    // Precise SVG for common flat tool icons — free diffusion models often invent wrong subjects.
    const deterministicIcon = tryBuildDeterministicFlatIcon(body)
    if (deterministicIcon) {
      pushProgress(
        progressLogs,
        'icon',
        `Matched known tool icon "${deterministicIcon.label}" — rendering exact flat SVG (free AI models are unreliable for this prompt).`,
      )
      respondSuccess({
        imageDataUrl: deterministicIcon.imageDataUrl,
        modelUsed: 'svg-icon',
        attempts: [selectedModel ?? 'svg-icon', 'svg-icon'],
        note: `Exact flat SVG icon (${deterministicIcon.label}) · free AI skipped for accuracy`,
      })
      return
    }

    // Best reference adherence: Gemini multimodal (when billing/quota allows).
    if (
      hasReference &&
      isConfigured() &&
      (isCloudflareWorkerModel(selectedModel) || isPollinationsModel(selectedModel))
    ) {
      pushProgress(
        progressLogs,
        'reference',
        'Reference attached — trying Gemini multimodal first for closest match…',
      )
      try {
        const started = Date.now()
        const { imageDataUrl, modelUsed, attempts } = await callGeminiImage({
          prompt: geminiPrompt,
          aspectRatio,
          preferredModel: 'gemini-2.5-flash-image',
          referenceImageDataUrl: body.referenceImageDataUrl,
          onAttempt: (model, index) => {
            pushProgress(
              progressLogs,
              'gemini',
              index === 0 ? `Using ${model} with reference image` : `Trying fallback ${model}`,
              index === 0 ? 'info' : 'warn',
            )
          },
        })
        pushProgress(
          progressLogs,
          'complete',
          `Gemini finished in ${((Date.now() - started) / 1000).toFixed(1)}s`,
        )
        respondSuccess({
          imageDataUrl,
          modelUsed,
          attempts,
          note: `Generated with ${modelUsed} (reference image attached)`,
        })
        return
      } catch (geminiRefError) {
        const message =
          geminiRefError instanceof Error ? geminiRefError.message : 'Gemini reference pass failed'
        pushProgress(
          progressLogs,
          'reference',
          `Gemini could not use the reference (${message.slice(0, 140)}). Falling back to Pollinations img2img…`,
          'warn',
        )
      }
    }

    // Cloudflare Worker free image API (your Workers endpoint).
    if (isCloudflareWorkerModel(selectedModel)) {
      if (hasReference) {
        pushProgress(
          progressLogs,
          'reference',
          'Cloudflare Worker is text-only — switching to Pollinations img2img so the reference image is used.',
          'warn',
        )
        await runPollinationsImg2Img('Reference image attached —', [CLOUDFLARE_WORKER_MODEL_ID])
        return
      }

      // SDXL on the free worker often ignores short icon subjects (wrong object / random scene).
      // Prefer Pollinations Flux for icon/sprite prompts unless the user picked Worker for other types.
      if (assetType === 'icon' || assetType === 'sprite') {
        pushProgress(
          progressLogs,
          'provider',
          `Cloudflare Worker is unreliable for ${assetType} prompts — switching to Pollinations Flux for better subject match.`,
          'warn',
        )
        const modelId = POLLINATIONS_MODEL_ID
        pushProgress(
          progressLogs,
          'pollinations',
          `Sending Pollinations request (flux) for ${assetType}…`,
        )
        pushProgress(progressLogs, 'prompt', `Visual prompt: ${pollinationsPrompt.slice(0, 220)}…`, 'debug')
        const started = Date.now()
        const imageDataUrl = await callPollinationsImage(
          pollinationsPrompt,
          aspectRatio,
          modelId,
          body,
          null,
        )
        pushProgress(
          progressLogs,
          'complete',
          `Pollinations finished in ${((Date.now() - started) / 1000).toFixed(1)}s`,
        )
        respondSuccess({
          imageDataUrl,
          modelUsed: modelId,
          attempts: [CLOUDFLARE_WORKER_MODEL_ID, modelId],
          note: `Generated with Pollinations Flux (better for ${assetType}) · ${artStyle}/${aspectRatio}`,
        })
        return
      }

      if (!isCloudflareWorkerImageConfigured()) {
        pushProgress(
          progressLogs,
          'validate',
          'Cloudflare Worker API key missing. Set CF_WORKER_IMAGE_API_KEY in .env',
          'error',
        )
        res.status(400).json({
          error:
            'Cloudflare Worker image API is not configured. Add CF_WORKER_IMAGE_API_KEY (Bearer secret) to .env.',
          progressLogs,
        })
        return
      }
      pushProgress(
        progressLogs,
        'settings',
        `Applying settings → type=${assetType}, style=${artStyle}, aspect=${aspectRatio}`,
      )
      pushProgress(progressLogs, 'cloudflare', 'Sending request to Cloudflare Worker image API…')
      pushProgress(progressLogs, 'prompt', `Visual prompt: ${pollinationsPrompt.slice(0, 220)}…`, 'debug')
      const started = Date.now()
      const imageDataUrl = await callCloudflareWorkerImage(body, pollinationsPrompt)
      pushProgress(
        progressLogs,
        'complete',
        `Cloudflare Worker finished in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      )
      respondSuccess({
        imageDataUrl,
        modelUsed: CLOUDFLARE_WORKER_MODEL_ID,
        note: `Generated with Cloudflare Worker · ${assetType}/${artStyle}/${aspectRatio}`,
      })
      return
    }

    // Free path: Pollinations (no Gemini billing required).
    if (isPollinationsModel(selectedModel)) {
      const modelId =
        hasReference && selectedModel === 'pollinations-flux'
          ? 'pollinations-klein'
          : (selectedModel ?? POLLINATIONS_MODEL_ID)
      if (hasReference) {
        pushProgress(
          progressLogs,
          'reference',
          referencePublicUrl
            ? `Attaching reference image to Pollinations img2img (${POLLINATIONS_BACKEND[modelId] ?? 'klein'})…`
            : 'Reference upload failed — Pollinations may ignore the reference.',
          referencePublicUrl ? 'info' : 'warn',
        )
      }
      pushProgress(
        progressLogs,
        'pollinations',
        `Sending free Pollinations request (${POLLINATIONS_BACKEND[modelId] ?? 'flux'}${
          hasReference ? ' + reference' : ''
        })…`,
      )
      pushProgress(progressLogs, 'prompt', `Visual prompt: ${pollinationsPrompt.slice(0, 180)}…`, 'debug')
      const started = Date.now()
      const imageDataUrl = await callPollinationsImage(
        pollinationsPrompt,
        aspectRatio,
        modelId,
        body,
        referencePublicUrl,
      )
      pushProgress(
        progressLogs,
        'complete',
        `Pollinations finished in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      )
      respondSuccess({
        imageDataUrl,
        modelUsed: modelId,
        note: hasReference
          ? `Generated with Pollinations img2img · ${assetType}/${artStyle}/${aspectRatio}`
          : `Generated with free Pollinations · ${assetType}/${artStyle}/${aspectRatio}`,
      })
      return
    }

    if (!isConfigured()) {
      await runFreeFallback('No GEMINI_API_KEY —')
      return
    }

    pushProgress(progressLogs, 'gemini', 'Sending request to Google Gemini…')
    const started = Date.now()
    try {
      const { imageDataUrl, modelUsed, attempts } = await callGeminiImage({
        prompt: geminiPrompt,
        aspectRatio,
        preferredModel: selectedModel ?? undefined,
        referenceImageDataUrl: body.referenceImageDataUrl,
        onAttempt: (model, index) => {
          pushProgress(
            progressLogs,
            'gemini',
            index === 0 ? `Using selected model ${model}` : `Trying fallback model ${model}`,
            index === 0 ? 'info' : 'warn',
          )
        },
        onRetry: (model, waitMs, status) => {
          pushProgress(
            progressLogs,
            'retry',
            `Rate limited (${status}) on ${model} — waiting ${(waitMs / 1000).toFixed(1)}s then retrying…`,
            'warn',
          )
        },
      })
      pushProgress(
        progressLogs,
        'complete',
        `Gemini finished in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      )
      respondSuccess({
        imageDataUrl,
        modelUsed,
        attempts,
        note: `Generated with ${modelUsed}`,
      })
      return
    } catch (geminiError) {
      const message = geminiError instanceof Error ? geminiError.message : 'Gemini generation failed'
      pushProgress(progressLogs, 'gemini', message, 'error')

      if (isHardQuotaError(message)) {
        await runFreeFallback('Gemini quota unavailable —', [selectedModel ?? 'gemini'])
        return
      }

      throw geminiError
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image generation failed'
    pushProgress(progressLogs, 'error', message, 'error')
    res.status(502).json({ error: message, configured: true, progressLogs })
  }
}

async function callCloudflareWorkerImage(
  body: Generate2DBody,
  composedPrompt: string,
): Promise<string> {
  if (!isCloudflareWorkerImageConfigured()) {
    throw new Error('Cloudflare Worker image API is not configured (missing Bearer key).')
  }

  const aspectRatio = (body.aspectRatio ?? '1:1') as AspectRatio
  const { width, height } = ASPECT_SIZE[aspectRatio]
  const assetType = body.assetType ?? 'ui'
  const artStyle = body.artStyle ?? 'flat-ui'
  const negativePrompt = buildNegativePrompt(body)

  // Worker only reads `prompt` — keep it subject-first and short (composedPrompt already is).
  const payload = {
    prompt: composedPrompt,
    negative_prompt: negativePrompt,
    negativePrompt,
    width,
    height,
    aspect_ratio: aspectRatio,
    aspectRatio,
    asset_type: assetType,
    assetType,
    art_style: artStyle,
    artStyle,
    seed: Math.floor(Math.random() * 1_000_000_000),
    refine: Boolean(body.refine),
    refine_prompt: body.refinePrompt?.trim() || undefined,
  }

  const response = await fetch(CF_WORKER_IMAGE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CF_WORKER_IMAGE_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'image/*',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    let detail = ''
    try {
      detail = (await response.text()).slice(0, 220)
    } catch {
      // ignore
    }
    throw new Error(
      `Cloudflare Worker image API failed (${response.status})${detail ? `: ${detail}` : ''}`,
    )
  }

  const contentType = response.headers.get('content-type') || 'image/png'
  if (!contentType.startsWith('image/') && !contentType.includes('octet-stream')) {
    const text = (await response.text()).slice(0, 220)
    throw new Error(`Cloudflare Worker returned non-image response: ${text || contentType}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength < 256) {
    throw new Error('Cloudflare Worker returned an empty image.')
  }

  const mimeType = contentType.startsWith('image/') ? contentType : 'image/png'
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

async function callPollinationsImage(
  prompt: string,
  aspectRatio: AspectRatio,
  modelId: string,
  body?: Generate2DBody,
  referenceImageUrl?: string | null,
): Promise<string> {
  const { width, height } = ASPECT_SIZE[aspectRatio]
  // Cap free-API resolution a bit — very large canvases often look worse / softer.
  const maxSide = 1024
  const scale = Math.min(1, maxSide / Math.max(width, height))
  const finalWidth = Math.round(width * scale)
  const finalHeight = Math.round(height * scale)
  // Klein follows reference images more reliably than flux on the free endpoint.
  const backend = referenceImageUrl
    ? POLLINATIONS_BACKEND[modelId] === 'klein'
      ? 'klein'
      : POLLINATIONS_BACKEND[modelId] === 'zimage'
        ? 'zimage'
        : 'klein'
    : (POLLINATIONS_BACKEND[modelId] ?? 'flux')
  // Keep enhance off for strict UI/pixel styles — enhance can drift to painterly.
  const enhance =
    !referenceImageUrl &&
    (body?.artStyle === 'illustration' || body?.artStyle === 'game-asset')

  const url = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`)
  url.searchParams.set('width', String(finalWidth))
  url.searchParams.set('height', String(finalHeight))
  url.searchParams.set('model', backend)
  url.searchParams.set('enhance', enhance ? 'true' : 'false')
  url.searchParams.set('nologo', 'true')
  url.searchParams.set('private', 'true')
  url.searchParams.set('referrer', 'bbextract')
  // Unique seed avoids Pollinations cache returning an unrelated prior image.
  url.searchParams.set('seed', String(Math.floor(Math.random() * 1_000_000_000)))
  if (referenceImageUrl) {
    url.searchParams.set('image', referenceImageUrl)
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'image/*',
      'User-Agent': 'bbextract/generate-2d',
    },
  })

  if (!response.ok) {
    throw new Error(`Pollinations request failed (${response.status}). Try again in a few seconds.`)
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg'
  if (!contentType.startsWith('image/')) {
    throw new Error('Pollinations returned a non-image response. The free API may be rate-limited.')
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength < 256) {
    throw new Error('Pollinations returned an empty image. Please retry.')
  }

  return `data:${contentType};base64,${buffer.toString('base64')}`
}

async function callGeminiImage(options: {
  prompt: string
  aspectRatio: AspectRatio
  preferredModel?: string
  referenceImageDataUrl?: string
  onAttempt?: (model: string, index: number) => void
  onRetry?: (model: string, waitMs: number, status: number) => void
}): Promise<{ imageDataUrl: string; modelUsed: string; attempts: string[] }> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured.')
  }

  // Official SDK path from Google AI Studio / Nano Banana getting-started docs.
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  const attempts: string[] = []
  let lastError: Error | null = null
  const modelChain = resolveModelChain(options.preferredModel)

  // Put the reference image first so multimodal models condition on pixels before the text brief.
  const contents: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = []
  if (options.referenceImageDataUrl) {
    const parsed = parseDataUrl(options.referenceImageDataUrl)
    if (parsed) {
      contents.push({
        inlineData: {
          mimeType: parsed.mimeType,
          data: parsed.data,
        },
      })
    }
  }
  contents.push({ text: options.prompt })

  for (let index = 0; index < modelChain.length; index += 1) {
    const model = modelChain[index]!
    options.onAttempt?.(model, index)
    attempts.push(model)

    for (let retry = 0; retry < 2; retry += 1) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents,
          config: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: {
              aspectRatio: options.aspectRatio,
            },
          },
        })

        const responseParts = response.candidates?.[0]?.content?.parts ?? []
        const imagePart = responseParts.find((part) => part.inlineData?.data)
        const data = imagePart?.inlineData?.data
        const mimeType = imagePart?.inlineData?.mimeType || 'image/png'

        if (!data) {
          const text =
            response.text ||
            responseParts
              .map((part) => part.text)
              .filter(Boolean)
              .join(' ')
          const finish = response.candidates?.[0]?.finishReason
          throw new Error(
            text
              ? `Gemini returned text instead of an image: ${String(text).slice(0, 220)}`
              : `Gemini returned no image data${finish ? ` (finishReason=${finish})` : ''}.`,
          )
        }

        return {
          imageDataUrl: `data:${mimeType};base64,${data}`,
          modelUsed: model,
          attempts,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Gemini generation failed'
        lastError = new Error(formatGeminiError(message))

        if (isHardQuotaError(message)) {
          throw lastError
        }

        const isRateLimit = /429|too many requests|RESOURCE_EXHAUSTED/i.test(message)
        if (isRateLimit && retry < 1) {
          const waitMs = parseRetryMs(message) ?? 2000
          options.onRetry?.(model, waitMs, 429)
          await sleep(waitMs)
          continue
        }
        break
      }
    }
  }

  throw lastError ?? new Error('Gemini generation failed for all configured models.')
}
