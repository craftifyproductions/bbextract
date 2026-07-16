export type ProcessingStage =
  | 'parsing'
  | 'decoding_textures'
  | 'extracting_animations'
  | 'building_structure'
  | 'done'
  | 'error'

export interface MetadataPayload {
  name: string
  model_identifier?: string
  format_version?: number | string
  model_format?: string
  box_uv?: boolean
  resolution?: { width: number; height: number }
  visible_box?: unknown
  uuid?: string
}

export interface ExtractedTexture {
  uuid: string
  name: string
  id?: number | string
  width: number
  height: number
  filename: string
  blob: Blob
  previewUrl: string
}

export type DirectUploadAssetKind = 'texture' | 'json'

export interface ModelUploadItem {
  kind: 'model'
  file: File
  sourceArchive?: string
  originalPath?: string
  uploadBatchId?: string
  uploadBatchComplete?: boolean
}

export interface DirectUploadAssetItem {
  kind: 'asset'
  file: File
  assetKind: DirectUploadAssetKind
  sourceArchive?: string
  originalPath?: string
  uploadBatchId?: string
  uploadBatchComplete?: boolean
}

export type UploadItem = ModelUploadItem | DirectUploadAssetItem

export interface WorkerExtractedTexture {
  uuid: string
  name: string
  id?: number | string
  width: number
  height: number
  filename: string
  blobBuffer: ArrayBuffer
  mime: string
}

export interface ExtractedAnimation {
  name: string
  length: number
  loop: boolean | string
  keyframeCount: number
  filename: string
  data: Record<string, unknown>
}

export interface SummaryPayload {
  elementCount: number
  cubeCount: number
  meshCount: number
  boneCount: number
  textureCount: number
  animationCount: number
  totalKeyframes: number
  originalFilename: string
  extractedAt: string
  warnings?: string[]
}

export interface TexturesManifestEntry {
  uuid: string
  name: string
  id?: number | string
  width: number
  height: number
  filename: string
}

export interface AnimationsManifestEntry {
  name: string
  length: number
  loop: boolean | string
  keyframeCount: number
  filename: string
}

export interface ModelHeavyData {
  rawText: string
  geometry: { elements: unknown[]; outliner: unknown[] }
  animations: ExtractedAnimation[]
  textures: ExtractedTexture[]
}

/** Lightweight React state — heavy blobs live in modelDataStore. */
export interface ProcessedModel {
  id: string
  fileHash?: string
  folderName: string
  originalFilename: string
  originalSizeBytes: number
  extractedSizeBytes: number
  metadata: MetadataPayload
  geometry: { elements: unknown[]; outliner: unknown[] }
  textures: TexturesManifestEntry[]
  animations: AnimationsManifestEntry[]
  summary: SummaryPayload
  rawText?: string
  status: 'processing' | 'done' | 'error'
  progress?: ProcessingStage
  error?: string
}

/** Slim worker postMessage payload — rawText stays on the main thread. */
export interface WorkerParsedModel {
  folderName: string
  originalFilename: string
  originalSizeBytes: number
  extractedSizeBytes: number
  metadata: MetadataPayload
  textures: WorkerExtractedTexture[]
  summary: SummaryPayload
  status: 'done' | 'error'
  error?: string
}

export interface WorkerTextureSource {
  uuid?: string
  name?: string
  id?: number | string
  width: number
  height: number
  source: unknown
}

export interface WorkerDecodeTexturesInput {
  folderName: string
  originalFilename: string
  originalSizeBytes: number
  rawTextLength: number
  metadata: MetadataPayload
  texturesRaw: WorkerTextureSource[]
  summary: SummaryPayload
}

export interface AggregateStats {
  modelCount: number
  textureCount: number
  animationCount: number
  elementCount: number
}

export type WorkerInboundMessage = {
  type: 'processBuffer'
  id: string
  filename: string
  originalSizeBytes: number
  buffer: ArrayBuffer
}

export interface ProcessingProgressDetail {
  textureCount?: number
  animationCount?: number
  elementCount?: number
  checkpoint?: string
}

export type WorkerDebugStage =
  | 'afterDecode'
  | 'afterJsonParse'
  | 'afterPrepare'
  | 'afterTextures'
  | 'beforeDone'
  | 'afterDone'

export type WorkerOutboundMessage =
  | { type: 'progress'; id: string; stage: ProcessingStage } & ProcessingProgressDetail
  | { type: 'debug'; id: string; stage: WorkerDebugStage; data?: Record<string, unknown> }
  | {
      type: 'done'
      id: string
      result: WorkerParsedModel
      animationMeta: AnimationsManifestEntry[]
      rawText: string
    }
  | { type: 'error'; id: string; message: string }
