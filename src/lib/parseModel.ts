import { decodeTexture, decodeTextureToBuffer } from './decodeTexture'
import {
  filenameWithoutExtension,
  makeUniqueFilename,
  sanitizeFileName,
  sanitizeFolderName,
} from './sanitize'
import { countAnimationKeyframes, countBones, countElements } from './stats'
import type {
  AnimationsManifestEntry,
  ExtractedAnimation,
  ExtractedTexture,
  MetadataPayload,
  ProcessedModel,
  SummaryPayload,
  TexturesManifestEntry,
  WorkerDecodeTexturesInput,
  WorkerExtractedTexture,
  WorkerParsedModel,
  WorkerTextureSource,
} from './types'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function estimateJsonSize(value: unknown): number {
  if (value === null) return 4
  if (value === undefined) return 0
  if (typeof value === 'boolean') return value ? 4 : 5
  if (typeof value === 'number') return String(value).length
  if (typeof value === 'string') return value.length + 2
  if (Array.isArray(value)) {
    if (value.length === 0) return 2
    return (
      2 +
      value.reduce(
        (sum, item, index) => sum + estimateJsonSize(item) + (index > 0 ? 1 : 0),
        0,
      )
    )
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return 2
    return (
      2 +
      entries.reduce((sum, [key, entryValue], index) => {
        const separator = index > 0 ? 1 : 0
        return sum + separator + key.length + 3 + estimateJsonSize(entryValue)
      }, 0)
    )
  }
  return 0
}

function createErrorModel(
  originalFilename: string,
  originalSizeBytes: number,
  error: string,
  rawText = '',
): ProcessedModel {
  return {
    id: crypto.randomUUID(),
    folderName: sanitizeFolderName(filenameWithoutExtension(originalFilename)),
    originalFilename,
    originalSizeBytes,
    extractedSizeBytes: 0,
    metadata: { name: filenameWithoutExtension(originalFilename) },
    geometry: { elements: [], outliner: [] },
    textures: [],
    animations: [],
    summary: {
      elementCount: 0,
      cubeCount: 0,
      meshCount: 0,
      boneCount: 0,
      textureCount: 0,
      animationCount: 0,
      totalKeyframes: 0,
      originalFilename,
      extractedAt: new Date().toISOString(),
    },
    rawText,
    status: 'error',
    error,
  }
}

function createWorkerErrorModel(
  originalFilename: string,
  originalSizeBytes: number,
  error: string,
): WorkerParsedModel {
  const model = createErrorModel(originalFilename, originalSizeBytes, error)
  return {
    folderName: model.folderName,
    originalFilename: model.originalFilename,
    originalSizeBytes: model.originalSizeBytes,
    extractedSizeBytes: model.extractedSizeBytes,
    metadata: model.metadata,
    textures: [],
    summary: model.summary,
    status: 'error',
    error: model.error,
  }
}

function extractMetadata(raw: Record<string, unknown>, fallbackName: string): MetadataPayload {
  const resolution = asRecord(raw.resolution)
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : fallbackName,
    model_identifier:
      typeof raw.model_identifier === 'string' ? raw.model_identifier : undefined,
    format_version:
      typeof raw.format_version === 'number' || typeof raw.format_version === 'string'
        ? raw.format_version
        : undefined,
    model_format: typeof raw.model_format === 'string' ? raw.model_format : undefined,
    box_uv: typeof raw.box_uv === 'boolean' ? raw.box_uv : undefined,
    resolution:
      resolution &&
      typeof resolution.width === 'number' &&
      typeof resolution.height === 'number'
        ? { width: resolution.width, height: resolution.height }
        : undefined,
    visible_box: raw.visible_box,
    uuid: typeof raw.uuid === 'string' ? raw.uuid : undefined,
  }
}

function toTextureManifest(textures: ExtractedTexture[]): TexturesManifestEntry[] {
  return textures.map(({ uuid, name, id, width, height, filename }) => ({
    uuid,
    name,
    id,
    width,
    height,
    filename,
  }))
}

function toAnimationManifest(animations: ExtractedAnimation[]): AnimationsManifestEntry[] {
  return animations.map(({ name, length, loop, keyframeCount, filename }) => ({
    name,
    length,
    loop,
    keyframeCount,
    filename,
  }))
}

function extractTexturesForMain(
  texturesRaw: unknown[],
  warnings: string[],
): ExtractedTexture[] {
  const seenUuids = new Set<string>()
  const usedFilenames = new Set<string>()
  const extracted: ExtractedTexture[] = []

  for (const item of texturesRaw) {
    const texture = asRecord(item)
    if (!texture) continue

    const uuid = typeof texture.uuid === 'string' ? texture.uuid : crypto.randomUUID()
    if (seenUuids.has(uuid)) continue
    seenUuids.add(uuid)

    const source = texture.source
    const blob = decodeTexture(source)
    if (!blob) {
      const name = typeof texture.name === 'string' ? texture.name : uuid.slice(0, 8)
      warnings.push(`Skipped malformed texture source for "${name}" (${uuid.slice(0, 8)})`)
      continue
    }

    const id = texture.id
    const name =
      typeof texture.name === 'string' && texture.name.trim()
        ? texture.name
        : `texture_${String(id ?? extracted.length)}`

    const fallbackBase = `texture_${String(id ?? extracted.length)}_${uuid.slice(0, 8)}`
    const filename = makeUniqueFilename(name, 'png', usedFilenames, uuid)

    const width = typeof texture.width === 'number' ? texture.width : 0
    const height = typeof texture.height === 'number' ? texture.height : 0
    const previewUrl = URL.createObjectURL(blob)

    extracted.push({
      uuid,
      name,
      id: typeof id === 'number' || typeof id === 'string' ? id : undefined,
      width,
      height,
      filename: filename || sanitizeFileName(fallbackBase, 'png'),
      blob,
      previewUrl,
    })
  }

  return extracted
}

export function slimTextureSources(texturesRaw: unknown[]): WorkerTextureSource[] {
  const slim: WorkerTextureSource[] = []

  for (const item of texturesRaw) {
    const texture = asRecord(item)
    if (!texture) continue

    slim.push({
      uuid: typeof texture.uuid === 'string' ? texture.uuid : undefined,
      name: typeof texture.name === 'string' ? texture.name : undefined,
      id:
        typeof texture.id === 'number' || typeof texture.id === 'string'
          ? texture.id
          : undefined,
      width: typeof texture.width === 'number' ? texture.width : 0,
      height: typeof texture.height === 'number' ? texture.height : 0,
      source: texture.source,
    })
  }

  return slim
}

export function extractTexturesForWorker(
  texturesRaw: WorkerTextureSource[] | unknown[],
  warnings: string[],
): WorkerExtractedTexture[] {
  const seenUuids = new Set<string>()
  const usedFilenames = new Set<string>()
  const extracted: WorkerExtractedTexture[] = []

  for (const item of texturesRaw) {
    const texture = asRecord(item)
    if (!texture) continue

    const uuid = typeof texture.uuid === 'string' ? texture.uuid : crypto.randomUUID()
    if (seenUuids.has(uuid)) continue
    seenUuids.add(uuid)

    const source = texture.source
    const decoded = decodeTextureToBuffer(source)
    if (!decoded) {
      const name = typeof texture.name === 'string' ? texture.name : uuid.slice(0, 8)
      warnings.push(`Skipped malformed texture source for "${name}" (${uuid.slice(0, 8)})`)
      continue
    }

    const id = texture.id
    const name =
      typeof texture.name === 'string' && texture.name.trim()
        ? texture.name
        : `texture_${String(id ?? extracted.length)}`

    const fallbackBase = `texture_${String(id ?? extracted.length)}_${uuid.slice(0, 8)}`
    const filename = makeUniqueFilename(name, 'png', usedFilenames, uuid)

    const width = typeof texture.width === 'number' ? texture.width : 0
    const height = typeof texture.height === 'number' ? texture.height : 0

    extracted.push({
      uuid,
      name,
      id: typeof id === 'number' || typeof id === 'string' ? id : undefined,
      width,
      height,
      filename: filename || sanitizeFileName(fallbackBase, 'png'),
      blobBuffer: decoded.buffer,
      mime: decoded.mime,
    })
  }

  return extracted
}

export function extractAnimationsMetaOnly(
  animationsRaw: unknown[],
  warnings: string[],
): AnimationsManifestEntry[] {
  const usedFilenames = new Set<string>()
  const extracted: AnimationsManifestEntry[] = []

  for (const item of animationsRaw) {
    const animation = asRecord(item)
    if (!animation) continue

    const name =
      typeof animation.name === 'string' && animation.name.trim()
        ? animation.name
        : `animation_${extracted.length}`

    const uuid =
      typeof animation.uuid === 'string' ? animation.uuid : crypto.randomUUID()
    const filename = makeUniqueFilename(name, 'json', usedFilenames, uuid)
    const length = typeof animation.length === 'number' ? animation.length : 0
    const loop = animation.loop ?? false

    extracted.push({
      name,
      length,
      loop: typeof loop === 'boolean' || typeof loop === 'string' ? loop : false,
      keyframeCount: 0,
      filename,
    })
  }

  if (animationsRaw.length > 0 && extracted.length === 0) {
    warnings.push('Animations array present but no valid animation entries extracted')
  }

  return extracted
}

function extractAnimations(
  animationsRaw: unknown[],
  warnings: string[],
): ExtractedAnimation[] {
  const usedFilenames = new Set<string>()
  const extracted: ExtractedAnimation[] = []

  for (const item of animationsRaw) {
    const animation = asRecord(item)
    if (!animation) continue

    const name =
      typeof animation.name === 'string' && animation.name.trim()
        ? animation.name
        : `animation_${extracted.length}`

    const uuid =
      typeof animation.uuid === 'string' ? animation.uuid : crypto.randomUUID()
    const filename = makeUniqueFilename(name, 'json', usedFilenames, uuid)
    const keyframeCount = countAnimationKeyframes(animation.animators)
    const length = typeof animation.length === 'number' ? animation.length : 0
    const loop = animation.loop ?? false

    extracted.push({
      name,
      length,
      loop: typeof loop === 'boolean' || typeof loop === 'string' ? loop : false,
      keyframeCount,
      filename,
      data: animation,
    })
  }

  if (animationsRaw.length > 0 && extracted.length === 0) {
    warnings.push('Animations array present but no valid animation entries extracted')
  }

  return extracted
}

export function extractGeometryAndAnimationsFromParsed(rawJson: unknown): {
  geometry: { elements: unknown[]; outliner: unknown[] }
  animations: ExtractedAnimation[]
} {
  const raw = asRecord(rawJson)
  if (!raw) {
    return { geometry: { elements: [], outliner: [] }, animations: [] }
  }

  const warnings: string[] = []
  return {
    geometry: { elements: asArray(raw.elements), outliner: asArray(raw.outliner) },
    animations: extractAnimations(asArray(raw.animations), warnings),
  }
}

function computeExtractedSize(
  metadata: MetadataPayload,
  geometry: { elements: unknown[]; outliner: unknown[] },
  textureSizes: number[],
  animations: ExtractedAnimation[],
  summary: SummaryPayload,
): number {
  let total = textureSizes.reduce((sum, size) => sum + size, 0)
  total += estimateJsonSize(metadata)
  total += estimateJsonSize(geometry.elements)
  total += estimateJsonSize(geometry.outliner)
  total += estimateJsonSize(summary)

  for (const animation of animations) {
    total += estimateJsonSize(animation.data)
  }

  return total
}

function computeExtractedSizeFast(
  rawTextLength: number,
  textureByteLengths: number[],
  animationCount: number,
): number {
  const textureBytes = textureByteLengths.reduce((sum, size) => sum + size, 0)
  const jsonEstimate = Math.round(rawTextLength * 0.15) + animationCount * 512
  return textureBytes + jsonEstimate
}

export interface ParseModelFromObjectOptions {
  rawText: string
  originalSizeBytes?: number
  forWorker?: boolean
}

export interface PrepareWorkerInputResult {
  input: WorkerDecodeTexturesInput
  animationMeta: AnimationsManifestEntry[]
  error?: string
}

export function prepareWorkerInputFromParsed(
  rawJson: unknown,
  originalFilename: string,
  options: { rawText: string; originalSizeBytes?: number; onCheckpoint?: (stage: string) => void },
): PrepareWorkerInputResult {
  const { rawText, onCheckpoint } = options
  const originalSizeBytes = options.originalSizeBytes ?? new TextEncoder().encode(rawText).length
  const fallbackName = filenameWithoutExtension(originalFilename)

  const raw = asRecord(rawJson)
  if (!raw) {
    return {
      input: {
        folderName: sanitizeFolderName(fallbackName),
        originalFilename,
        originalSizeBytes,
        rawTextLength: rawText.length,
        metadata: { name: fallbackName },
        texturesRaw: [],
        summary: {
          elementCount: 0,
          cubeCount: 0,
          meshCount: 0,
          boneCount: 0,
          textureCount: 0,
          animationCount: 0,
          totalKeyframes: 0,
          originalFilename,
          extractedAt: new Date().toISOString(),
        },
      },
      animationMeta: [],
      error: 'Invalid model: expected a JSON object at the top level',
    }
  }

  const warnings: string[] = []
  onCheckpoint?.('prepare:start')

  const elements = asArray(raw.elements)
  const outliner = asArray(raw.outliner)
  const texturesRaw = asArray(raw.textures)
  const animationsRaw = asArray(raw.animations)

  onCheckpoint?.('prepare:afterRootFields')

  if (!Array.isArray(raw.elements)) warnings.push('Missing elements array — treated as empty')
  if (!Array.isArray(raw.textures)) warnings.push('Missing textures array — treated as empty')
  if (!Array.isArray(raw.animations)) warnings.push('Missing animations array — treated as empty')

  onCheckpoint?.('prepare:afterWarnings')

  const metadata = extractMetadata(raw, fallbackName)
  onCheckpoint?.('prepare:afterMetadata')

  const folderName = sanitizeFolderName(metadata.name || fallbackName)

  onCheckpoint?.('prepare:beforeExtractAnimationsMetaOnly')
  const animationMeta = extractAnimationsMetaOnly(animationsRaw, warnings)
  onCheckpoint?.('prepare:afterExtractAnimationsMetaOnly')

  onCheckpoint?.('prepare:beforeCountElements')
  const elementStats = countElements(elements)
  onCheckpoint?.('prepare:afterCountElements')

  onCheckpoint?.('prepare:beforeCountBones')
  const boneCount = countBones(outliner)
  onCheckpoint?.('prepare:afterCountBones')

  const totalKeyframes = animationMeta.reduce((sum, anim) => sum + anim.keyframeCount, 0)

  onCheckpoint?.('prepare:beforeSlimTextureSources')
  const texturesRawSlim = slimTextureSources(texturesRaw)
  onCheckpoint?.('prepare:afterSlimTextureSources')

  const summary: SummaryPayload = {
    elementCount: elementStats.total,
    cubeCount: elementStats.cubes,
    meshCount: elementStats.meshes,
    boneCount,
    textureCount: texturesRaw.length,
    animationCount: animationMeta.length,
    totalKeyframes,
    originalFilename,
    extractedAt: new Date().toISOString(),
    ...(warnings.length > 0 ? { warnings } : {}),
  }

  return {
    input: {
      folderName,
      originalFilename,
      originalSizeBytes,
      rawTextLength: rawText.length,
      metadata,
      texturesRaw: texturesRawSlim,
      summary,
    },
    animationMeta,
  }
}

export interface ProcessModelBufferResult {
  result: WorkerParsedModel
  animationMeta: AnimationsManifestEntry[]
  rawText: string
  error?: string
}

export function processModelBuffer(
  buffer: ArrayBuffer,
  originalFilename: string,
  originalSizeBytes: number,
  onCheckpoint?: (stage: string) => void,
): ProcessModelBufferResult {
  const rawText = new TextDecoder().decode(buffer)
  onCheckpoint?.('afterDecode')

  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return {
      result: createWorkerErrorModel(originalFilename, originalSizeBytes, 'Invalid JSON'),
      animationMeta: [],
      rawText,
      error: 'Invalid JSON',
    }
  }

  onCheckpoint?.('afterJsonParse')

  const prepared = prepareWorkerInputFromParsed(parsed, originalFilename, {
    rawText,
    originalSizeBytes,
    onCheckpoint,
  })

  if (prepared.error) {
    return {
      result: createWorkerErrorModel(originalFilename, originalSizeBytes, prepared.error),
      animationMeta: [],
      rawText,
      error: prepared.error,
    }
  }

  onCheckpoint?.('afterPrepare')

  const result = decodeTexturesInWorker(prepared.input, onCheckpoint)

  return {
    result,
    animationMeta: prepared.animationMeta,
    rawText,
  }
}

export function decodeTexturesInWorker(
  input: WorkerDecodeTexturesInput,
  onCheckpoint?: (stage: string) => void,
): WorkerParsedModel {
  const warnings = [...(input.summary.warnings ?? [])]

  const textures = extractTexturesForWorker(input.texturesRaw, warnings)
  onCheckpoint?.('afterTextures')

  const summary = { ...input.summary, textureCount: textures.length }
  if (warnings.length > 0) summary.warnings = warnings

  const extractedSizeBytes = computeExtractedSizeFast(
    input.rawTextLength,
    textures.map((texture) => texture.blobBuffer.byteLength),
    summary.animationCount,
  )

  onCheckpoint?.('beforeDone')

  return {
    folderName: input.folderName,
    originalFilename: input.originalFilename,
    originalSizeBytes: input.originalSizeBytes,
    extractedSizeBytes,
    metadata: input.metadata,
    textures,
    summary,
    status: 'done',
  }
}

export function parseModelFromObject(
  rawJson: unknown,
  originalFilename: string,
  options: ParseModelFromObjectOptions & { forWorker: true },
): WorkerParsedModel
export function parseModelFromObject(
  rawJson: unknown,
  originalFilename: string,
  options?: ParseModelFromObjectOptions,
): ProcessedModel
export function parseModelFromObject(
  rawJson: unknown,
  originalFilename: string,
  options: ParseModelFromObjectOptions = { rawText: '' },
): ProcessedModel | WorkerParsedModel {
  const { rawText, forWorker = false } = options
  const originalSizeBytes = options.originalSizeBytes ?? new TextEncoder().encode(rawText).length
  const fallbackName = filenameWithoutExtension(originalFilename)

  const raw = asRecord(rawJson)
  if (!raw) {
    if (forWorker) {
      return createWorkerErrorModel(
        originalFilename,
        originalSizeBytes,
        'Invalid model: expected a JSON object at the top level',
      )
    }
    return createErrorModel(
      originalFilename,
      originalSizeBytes,
      'Invalid model: expected a JSON object at the top level',
      rawText,
    )
  }

  const warnings: string[] = []
  const elements = asArray(raw.elements)
  const outliner = asArray(raw.outliner)
  const texturesRaw = asArray(raw.textures)
  const animationsRaw = asArray(raw.animations)

  if (!Array.isArray(raw.elements)) warnings.push('Missing elements array — treated as empty')
  if (!Array.isArray(raw.textures)) warnings.push('Missing textures array — treated as empty')
  if (!Array.isArray(raw.animations)) warnings.push('Missing animations array — treated as empty')

  const metadata = extractMetadata(raw, fallbackName)
  const folderName = sanitizeFolderName(metadata.name || fallbackName)
  const animationMeta = extractAnimationsMetaOnly(animationsRaw, warnings)

  const elementStats = countElements(elements)
  const boneCount = countBones(outliner)

  const summary: SummaryPayload = {
    elementCount: elementStats.total,
    cubeCount: elementStats.cubes,
    meshCount: elementStats.meshes,
    boneCount,
    textureCount: 0,
    animationCount: animationMeta.length,
    totalKeyframes: 0,
    originalFilename,
    extractedAt: new Date().toISOString(),
    ...(warnings.length > 0 ? { warnings } : {}),
  }

  if (forWorker) {
    const prepared = prepareWorkerInputFromParsed(rawJson, originalFilename, {
      rawText,
      originalSizeBytes,
    })
    if (prepared.error) {
      return createWorkerErrorModel(originalFilename, originalSizeBytes, prepared.error)
    }
    return decodeTexturesInWorker(prepared.input)
  }

  const geometry = { elements, outliner }
  const animations = extractAnimations(animationsRaw, warnings)
  summary.totalKeyframes = animations.reduce((sum, anim) => sum + anim.keyframeCount, 0)
  const textures = extractTexturesForMain(texturesRaw, warnings)
  summary.textureCount = textures.length

  const extractedSizeBytes = computeExtractedSize(
    metadata,
    geometry,
    textures.map((texture) => texture.blob.size),
    animations,
    summary,
  )

  return {
    id: crypto.randomUUID(),
    folderName,
    originalFilename,
    originalSizeBytes,
    extractedSizeBytes,
    metadata,
    geometry,
    textures: toTextureManifest(textures),
    animations: toAnimationManifest(animations),
    summary,
    rawText,
    status: 'done',
    progress: 'done',
  }
}

export function parseModel(rawJson: unknown, originalFilename: string): ProcessedModel {
  const rawText =
    typeof rawJson === 'string' ? rawJson : JSON.stringify(rawJson ?? '')
  const result = parseModelFromObject(rawJson, originalFilename, { rawText })
  return result as ProcessedModel
}

export interface HydratedWorkerResult {
  model: ProcessedModel
  assetTextures: ExtractedTexture[]
}

export function workerTexturesToExtracted(
  workerTextures: WorkerExtractedTexture[],
): ExtractedTexture[] {
  return workerTextures.map((texture) => {
    const blob = new Blob([texture.blobBuffer], { type: texture.mime })
    return {
      uuid: texture.uuid,
      name: texture.name,
      id: texture.id,
      width: texture.width,
      height: texture.height,
      filename: texture.filename,
      blob,
      previewUrl: URL.createObjectURL(blob),
    }
  })
}

export function hydrateWorkerModel(
  workerResult: WorkerParsedModel,
  id: string,
  originalSizeBytes: number,
  rawText = '',
  animationMeta: AnimationsManifestEntry[] = [],
): HydratedWorkerResult {
  if (workerResult.status === 'error') {
    return {
      model: {
        id,
        folderName: workerResult.folderName,
        originalFilename: workerResult.originalFilename,
        originalSizeBytes,
        extractedSizeBytes: workerResult.extractedSizeBytes,
        metadata: workerResult.metadata,
        geometry: { elements: [], outliner: [] },
        textures: [],
        animations: [],
        summary: workerResult.summary,
        rawText,
        status: 'error',
        progress: 'error',
        error: workerResult.error,
      },
      assetTextures: [],
    }
  }

  const assetTextures = workerTexturesToExtracted(workerResult.textures)

  return {
    assetTextures,
    model: {
      id,
      folderName: workerResult.folderName,
      originalFilename: workerResult.originalFilename,
      originalSizeBytes,
      extractedSizeBytes: workerResult.extractedSizeBytes,
      metadata: workerResult.metadata,
      geometry: { elements: [], outliner: [] },
      textures: assetTextures.map(({ uuid, name, id: textureId, width, height, filename }) => ({
        uuid,
        name,
        id: textureId,
        width,
        height,
        filename,
      })),
      animations: animationMeta,
      summary: workerResult.summary,
      rawText,
      status: 'done',
      progress: 'done',
    },
  }
}

export function revokeModelUrls(_model: ProcessedModel): void {
  // Texture blob URLs are revoked via modelDataStore.remove/clear
}

