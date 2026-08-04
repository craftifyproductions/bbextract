import type { Request, Response } from 'express'
import JSZip from 'jszip'
import { isR2VectorConfigured } from './config.js'
import {
  assertRagProviderConfigured,
  labelWithModel,
  resolveRagLabelModel,
} from './ragBatch.js'
import { modelLabelRateLimiter } from './ragRateLimit.js'
import { syncModelToVectorBucket } from './r2.js'

export interface LabeledModelResult {
  name: string
  model: Record<string, unknown>
  label: Record<string, unknown>
  texture?: { mimeType: string; data: string; name: string } | null
}

const MAX_UPLOAD_BYTES = 80 * 1024 * 1024
const MAX_MODELS_PER_UPLOAD = 10

interface ZipEntry {
  path: string
  data: Buffer
}

function headerString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function sanitizeName(value: string): string {
  return value.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 120) || 'model'
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || path
}

function dirname(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

function parseJsonBuffer(buffer: Buffer): unknown {
  try {
    return JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''))
  } catch {
    return null
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

function mimeFromName(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  return 'image/png'
}

const MAX_TEXTURE_BYTES = 4_000_000

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
    // Path references (e.g. texture/skin.png) — not embedded bytes.
    return null
  }

  data = data.replace(/\s+/g, '')
  if (Math.floor((data.length * 3) / 4) > MAX_TEXTURE_BYTES) return null

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

function buildAnalysisFromModel(
  model: Record<string, unknown>,
  folderName: string,
  textureNames: string[],
): Record<string, unknown> {
  const elements = Array.isArray(model.elements) ? model.elements : []
  const outliner = Array.isArray(model.outliner) ? model.outliner : []
  const animations = Array.isArray(model.animations) ? model.animations : []
  const animationNames = animations
    .map((anim) =>
      anim && typeof anim === 'object' && typeof (anim as { name?: string }).name === 'string'
        ? (anim as { name: string }).name
        : null,
    )
    .filter((name): name is string => Boolean(name))

  let cubeCount = 0
  for (const el of elements) {
    if (!el || typeof el !== 'object') continue
    const type = String((el as { type?: string }).type || 'cube').toLowerCase()
    if (type === 'cube' || type === '') cubeCount += 1
  }
  const suggestedComplexity =
    (cubeCount > 0 ? cubeCount : elements.length) <= 24
      ? 'simple'
      : (cubeCount > 0 ? cubeCount : elements.length) <= 100
        ? 'medium'
        : 'complex'

  return {
    folder_name: folderName,
    display_name: (typeof model.name === 'string' && model.name) || folderName,
    model_format: model.model_format ?? (model.meta as { model_format?: string } | undefined)?.model_format ?? null,
    resolution: model.resolution ?? null,
    summary: {
      elementCount: elements.length,
      cubeCount,
      animationCount: animationNames.length,
      textureCount: textureNames.length,
    },
    element_count: elements.length,
    cube_count: cubeCount,
    suggested_complexity: suggestedComplexity,
    sample_element_names: elements
      .slice(0, 40)
      .map((el) => (el && typeof el === 'object' ? (el as { name?: string }).name : null))
      .filter(Boolean),
    bone_names: collectOutlinerNames(outliner),
    animation_names: animationNames,
    texture_names: textureNames,
    has_animation: animationNames.length > 0,
    has_metadata: Boolean(model.meta || model.model_format || model.uuid),
  }
}

async function loadZipEntries(buffer: Buffer): Promise<ZipEntry[]> {
  const zip = await JSZip.loadAsync(buffer)
  const entries: ZipEntry[] = []
  for (const [path, file] of Object.entries(zip.files)) {
    if (!file || file.dir) continue
    const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!normalized || normalized.includes('__MACOSX') || normalized.endsWith('.DS_Store')) continue
    const data = Buffer.from(await file.async('uint8array'))
    entries.push({ path: normalized, data })
  }
  return entries
}

interface LocalModelJob {
  name: string
  model: Record<string, unknown>
  bbmodelBytes: Buffer | null
  preview: { mimeType: string; data: string; name: string } | null
  textureNames: string[]
}

function jobsFromBbmodel(
  filename: string,
  buffer: Buffer,
  siblingTextures: ZipEntry[] = [],
): LocalModelJob[] {
  const parsed = parseJsonBuffer(buffer)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid .bbmodel JSON: ${filename}`)
  }
  const model = parsed as Record<string, unknown>
  const elements = Array.isArray(model.elements) ? model.elements : []
  if (elements.length === 0) {
    throw new Error(`No elements found in ${filename}`)
  }

  const name = sanitizeName(
    (typeof model.name === 'string' && model.name) ||
      filename.replace(/\.bbmodel$/i, '') ||
      'model',
  )

  const embeddedNames = (Array.isArray(model.textures) ? model.textures : [])
    .map((item) =>
      item && typeof item === 'object' && typeof (item as { name?: string }).name === 'string'
        ? (item as { name: string }).name
        : null,
    )
    .filter((value): value is string => Boolean(value))

  const textureNames = [
    ...siblingTextures.map((entry) => basename(entry.path).replace(/\.(png|jpe?g|webp)$/i, '')),
    ...embeddedNames,
  ]

  const preferredFile =
    siblingTextures.find((entry) => /skin|body|alex|steve|player|main/i.test(entry.path)) ??
    siblingTextures.find((entry) => entry.data.byteLength > 0 && entry.data.byteLength <= MAX_TEXTURE_BYTES) ??
    null

  const previewFromFile = preferredFile
    ? {
        mimeType: mimeFromName(preferredFile.path),
        data: preferredFile.data.toString('base64'),
        name: basename(preferredFile.path),
      }
    : null

  // Most .bbmodel uploads embed PNG/JPEG as data URIs — use those when no loose texture file exists.
  const preview = previewFromFile ?? extractEmbeddedTexture(model)

  return [
    {
      name,
      model,
      bbmodelBytes: buffer,
      preview,
      textureNames,
    },
  ]
}

function jobsFromZipEntries(entries: ZipEntry[]): LocalModelJob[] {
  const bbmodels = entries.filter((entry) => entry.path.toLowerCase().endsWith('.bbmodel'))
  if (bbmodels.length === 0) {
    throw new Error('Zip must contain at least one .bbmodel file')
  }

  const jobs: LocalModelJob[] = []
  for (const bb of bbmodels.slice(0, MAX_MODELS_PER_UPLOAD)) {
    const folder = dirname(bb.path)
    const parent = dirname(folder)
    const textures = entries.filter((entry) => {
      if (!/\.(png|jpe?g|webp)$/i.test(entry.path)) return false
      if (!folder) return true
      // Same folder, nested texture/, or parent texture/ folders.
      return (
        entry.path.startsWith(`${folder}/`) ||
        dirname(entry.path) === folder ||
        /\/texture\//i.test(entry.path) ||
        (parent && entry.path.startsWith(`${parent}/texture/`))
      )
    })
    jobs.push(...jobsFromBbmodel(basename(bb.path), bb.data, textures))
  }
  return jobs
}

/**
 * POST /api/rag/label-upload
 * Headers:
 *   X-BBExtract-Filename: file.zip | file.bbmodel
 *   X-BBExtract-Model: optional label model id
 * Body: raw file bytes
 * Response JSON: { ok, models: [{ name, model, label }] }
 */
export async function ragLabelUploadHandler(req: Request, res: Response): Promise<void> {
  try {
    const filename = sanitizeName(
      headerString(req.headers['x-bbextract-filename']) || 'upload.bin',
    )
    const labelModel = resolveRagLabelModel(headerString(req.headers['x-bbextract-model']))
    assertRagProviderConfigured(labelModel)

    const body = req.body
    const buffer = Buffer.isBuffer(body)
      ? body
      : body instanceof Uint8Array
        ? Buffer.from(body)
        : null

    if (!buffer || buffer.byteLength === 0) {
      res.status(400).json({ error: 'Empty upload body. Send the file as raw bytes.' })
      return
    }
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      res.status(413).json({
        error: `Upload exceeds ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`,
      })
      return
    }

    const rate = modelLabelRateLimiter.getStatus(labelModel)
    if (rate.rpdRemaining <= 0) {
      res.status(429).json({
        error: `Daily limit reached for ${labelModel} (${rate.rpdLimit} RPD).`,
      })
      return
    }

    const lower = filename.toLowerCase()
    let jobs: LocalModelJob[]
    if (lower.endsWith('.bbmodel')) {
      jobs = jobsFromBbmodel(filename, buffer)
    } else if (lower.endsWith('.zip')) {
      const entries = await loadZipEntries(buffer)
      jobs = jobsFromZipEntries(entries)
    } else {
      res.status(400).json({ error: 'Upload a .zip or .bbmodel file' })
      return
    }

    if (jobs.length === 0) {
      res.status(400).json({ error: 'No labelable models found in upload' })
      return
    }
    if (jobs.length > rate.rpdRemaining) {
      res.status(429).json({
        error: `Upload has ${jobs.length} model(s) but only ${rate.rpdRemaining} RPD remaining for ${labelModel}`,
      })
      return
    }

    const models: LabeledModelResult[] = []
    for (const job of jobs) {
      const analysis = buildAnalysisFromModel(job.model, job.name, job.textureNames)
      const label = await labelWithModel(analysis, job.preview, labelModel)
      models.push({
        name: job.name,
        model: job.model,
        label,
        // Keep preview texture for later vector-db upload (generation quality).
        texture: job.preview,
      })
    }

    res.json({
      ok: true,
      count: models.length,
      labelModel,
      sourceFilename: filename,
      models,
    })
  } catch (error) {
    console.error('[BBExtract] RAG label-upload error:', error)
    const message = error instanceof Error ? error.message : 'Failed to label upload'
    const status = /daily limit|not configured|RPD/i.test(message)
      ? /not configured/i.test(message)
        ? 503
        : 429
      : 500
    res.status(status).json({ error: message })
  }
}

/**
 * POST /api/rag/vector-upload
 * Body JSON: { models: [{ name, model, label, texture? }] }
 * Uploads into vector-db/{name}/model.json + label.json + texture + meta.json
 */
export async function ragVectorUploadHandler(req: Request, res: Response): Promise<void> {
  try {
    if (!isR2VectorConfigured()) {
      res.status(503).json({
        error: 'R2 vector bucket is not configured (set R2_VECTOR_BUCKET=vector-db)',
      })
      return
    }

    const body = (req.body ?? {}) as {
      models?: Array<{
        name?: string
        model?: Record<string, unknown>
        label?: Record<string, unknown>
        texture?: { mimeType?: string; data?: string; name?: string } | null
      }>
    }
    const models = Array.isArray(body.models) ? body.models : []
    if (models.length === 0) {
      res.status(400).json({ error: 'No models provided. Label a file first.' })
      return
    }
    if (models.length > MAX_MODELS_PER_UPLOAD) {
      res.status(400).json({ error: `Max ${MAX_MODELS_PER_UPLOAD} models per upload` })
      return
    }

    const uploaded: string[] = []
    const failed: Array<{ name: string; error: string }> = []

    for (const item of models) {
      const name = sanitizeName(String(item.name || 'model'))
      if (!item.model || !item.label) {
        failed.push({ name, error: 'Missing model or label JSON' })
        continue
      }
      try {
        const texture =
          item.texture?.data && item.texture.mimeType
            ? {
                bytes: Buffer.from(item.texture.data, 'base64'),
                mimeType: item.texture.mimeType,
                filename: item.texture.name,
              }
            : null
        const synced = await syncModelToVectorBucket({
          folderName: name,
          modelJson: item.model,
          labelJson: item.label,
          texture,
          meta: {
            model_name: name,
            category: item.label.category ?? null,
            subcategory: item.label.subcategory ?? null,
            source: 'local-upload',
          },
        })
        uploaded.push(synced.folder)
      } catch (error) {
        failed.push({
          name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    res.json({
      ok: failed.length === 0,
      uploaded,
      failed,
      message:
        uploaded.length > 0
          ? `Uploaded ${uploaded.length} model(s) to vector-db (json + texture when available): ${uploaded.join(', ')}`
          : 'No models uploaded to vector-db',
    })
  } catch (error) {
    console.error('[BBExtract] RAG vector-upload error:', error)
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to upload to vector-db',
    })
  }
}
