import JSZip from 'jszip'
import { deleteR2File, deleteR2Prefix, downloadR2File, uploadR2File } from './api'
import { buildModelZip } from './buildZip'
import { loadEnvSettings } from './envSettings'
import { modelDataStore } from './modelDataStore'
import { recordAuditEvent } from './auditLogStore'
import type { SessionLogRecord } from './sessionLogger'
import { getSupabaseClient } from './supabaseClient'
import { buildGroupedAssetLocation, buildModelStorageRoot } from './modelAssetGrouping'
import type { ShouldCancelUpload } from './uploadCancel'
import type { DirectUploadAssetItem, ProcessedModel } from './types'

export interface StoredExtractedFile {
  id: string
  runId: string
  userEmail?: string | null
  modelName: string
  fileKind: string
  filename: string
  storageBucket: string
  storagePath: string
  mimeType?: string | null
  sizeBytes?: number | null
  createdAt: string
}

export interface StoredExtractedModel {
  id: string
  runId?: string | null
  userEmail?: string | null
  modelName: string
  originalFilename: string
  fileHash: string
  folderName?: string | null
  originalSizeBytes?: number | null
  extractedSizeBytes?: number | null
  elementCount?: number | null
  boneCount?: number | null
  textureCount?: number | null
  animationCount?: number | null
  modelZipPath?: string | null
  createdAt: string
}

interface ExtractedFileRow {
  id: string
  run_id: string
  user_email?: string | null
  model_name: string
  file_kind: string
  filename: string
  storage_bucket: string
  storage_path: string
  mime_type?: string | null
  size_bytes?: number | null
  created_at: string
}

interface ExtractedModelRow {
  id: string
  run_id?: string | null
  user_email?: string | null
  model_name: string
  original_filename: string
  file_hash: string
  folder_name?: string | null
  original_size_bytes?: number | null
  extracted_size_bytes?: number | null
  element_count?: number | null
  bone_count?: number | null
  texture_count?: number | null
  animation_count?: number | null
  model_zip_path?: string | null
  created_at: string
}

interface FileToUpload {
  kind: StoredExtractedFile['fileKind']
  filename: string
  blob: Blob
}

interface ListStoredFilesOptions {
  verifyBucket?: boolean
}

interface StorageListObject {
  id?: string | null
  name: string
  created_at?: string | null
  updated_at?: string | null
  metadata?: {
    size?: number
    mimetype?: string
  } | null
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'file'
}

function jsonBlob(data: unknown): Blob {
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
}

function rowToStoredFile(row: ExtractedFileRow): StoredExtractedFile {
  return {
    id: row.id,
    runId: row.run_id,
    userEmail: row.user_email,
    modelName: row.model_name,
    fileKind: row.file_kind,
    filename: row.filename,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  }
}

function rowToStoredModel(row: ExtractedModelRow): StoredExtractedModel {
  return {
    id: row.id,
    runId: row.run_id,
    userEmail: row.user_email,
    modelName: row.model_name,
    originalFilename: row.original_filename,
    fileHash: row.file_hash,
    folderName: row.folder_name,
    originalSizeBytes: row.original_size_bytes,
    extractedSizeBytes: row.extracted_size_bytes,
    elementCount: row.element_count,
    boneCount: row.bone_count,
    textureCount: row.texture_count,
    animationCount: row.animation_count,
    modelZipPath: row.model_zip_path,
    createdAt: row.created_at,
  }
}

function inferFileKind(filename: string, storagePath: string): string {
  const path = storagePath.toLowerCase()
  const name = filename.toLowerCase()
  if (path.includes('/model_zip/') || name.endsWith('.zip')) return 'model_zip'
  if (path.includes('/texture/') || /\.(png|jpe?g|webp)$/.test(name)) return 'texture'
  if (name === 'metadata.json') return 'metadata'
  if (name === 'summary.json') return 'summary'
  if (path.includes('/json/') || name.endsWith('.json')) return 'json'
  if (path.includes('/animation/')) return 'animation'
  if (path.includes('/geometry/')) return 'geometry'
  if (name.endsWith('.bbmodel')) return 'raw_model'
  return 'file'
}

function inferModelNameFromPath(storagePath: string): string {
  const parts = storagePath.split('/')
  return parts[1] || 'Bucket files'
}

function dirname(storagePath: string): string {
  const parts = storagePath.split('/')
  parts.pop()
  return parts.join('/')
}

function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/')
}

function filenameFromPath(storagePath: string): string {
  return storagePath.split('/').pop() || storagePath
}

function r2BucketLabel(bucket: string): string {
  return `r2:${bucket}`
}

function isR2StoredFile(file: Pick<StoredExtractedFile, 'storageBucket'>): boolean {
  return file.storageBucket.startsWith('r2:')
}

function isEditableStoredFile(file: StoredExtractedFile): boolean {
  const name = file.filename.toLowerCase()
  const mime = file.mimeType?.toLowerCase() ?? ''
  return (
    mime.startsWith('text/') ||
    mime.includes('json') ||
    /\.(json|txt|mcmeta|bbmodel|geo)$/i.test(name)
  )
}

function formatStorageTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return new Date().toISOString().replace(/[:.]/g, '-')
  return date.toISOString().replace('T', '_').replace(/[:.]/g, '-').replace('Z', '')
}

async function listBucketObjectsRecursive(
  path = '',
  limit = 1000,
): Promise<StoredExtractedFile[]> {
  const supabase = await getSupabaseClient()
  if (!supabase) return []

  const bucket = loadEnvSettings().storageBucket
  const { data, error } = await supabase.storage.from(bucket).list(path, {
    limit,
    sortBy: { column: 'created_at', order: 'desc' },
  })

  if (error) throw new Error(error.message)

  const files: StoredExtractedFile[] = []
  for (const item of (data ?? []) as StorageListObject[]) {
    const storagePath = path ? `${path}/${item.name}` : item.name
    const isFolder = !item.id && !item.metadata?.size

    if (isFolder) {
      files.push(...(await listBucketObjectsRecursive(storagePath, limit)))
      continue
    }

    files.push({
      id: `bucket:${storagePath}`,
      runId: storagePath.split('/')[0] || 'bucket',
      modelName: inferModelNameFromPath(storagePath),
      fileKind: inferFileKind(item.name, storagePath),
      filename: item.name,
      storageBucket: bucket,
      storagePath,
      mimeType: item.metadata?.mimetype ?? null,
      sizeBytes: item.metadata?.size ?? null,
      createdAt: item.created_at ?? item.updated_at ?? new Date().toISOString(),
    })
  }

  return files
}

export async function findExistingModelHashes(hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set()

  const supabase = await getSupabaseClient()
  if (!supabase) return new Set()

  const { data, error } = await supabase
    .from('extracted_models')
    .select('file_hash')
    .in('file_hash', hashes)

  if (error) throw new Error(error.message)
  return new Set(((data ?? []) as Array<{ file_hash: string }>).map((row) => row.file_hash))
}

async function buildFilesForModel(model: ProcessedModel): Promise<FileToUpload[]> {
  const heavyData = modelDataStore.ensureHeavyData(model.id, model.rawText)
  const files: FileToUpload[] = []

  const modelZip = await buildModelZip(model)
  files.push({
    kind: 'model_zip',
    filename: `${model.folderName}.zip`,
    blob: new Blob([modelZip], { type: 'application/zip' }),
  })

  files.push({ kind: 'metadata', filename: 'metadata.json', blob: jsonBlob(model.metadata) })
  files.push({ kind: 'summary', filename: 'summary.json', blob: jsonBlob(model.summary) })

  if (heavyData?.rawText) {
    files.push({
      kind: 'raw_model',
      filename: model.originalFilename,
      blob: new Blob([heavyData.rawText], { type: 'application/json;charset=utf-8' }),
    })
  }

  if (heavyData?.geometry) {
    files.push({
      kind: 'geometry',
      filename: 'elements.json',
      blob: jsonBlob(heavyData.geometry.elements),
    })
    files.push({
      kind: 'geometry',
      filename: 'outliner.json',
      blob: jsonBlob(heavyData.geometry.outliner),
    })
  }

  for (const texture of heavyData?.textures ?? []) {
    files.push({ kind: 'texture', filename: texture.filename, blob: texture.blob })
  }

  for (const animation of heavyData?.animations ?? []) {
    files.push({ kind: 'animation', filename: animation.filename, blob: jsonBlob(animation.data) })
  }

  return files
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

const MAX_EXTRACTION_RUN_CONTENT_BYTES = 4 * 1024 * 1024

/** Minimal run row required by extracted_files.run_id (full log save is best-effort). */
export async function ensureExtractionRunForUpload(run: SessionLogRecord): Promise<void> {
  const supabase = await getSupabaseClient()
  if (!supabase) {
    throw new Error('Supabase metadata store is unavailable')
  }

  let content = run.content
  if (content.length > MAX_EXTRACTION_RUN_CONTENT_BYTES) {
    content = `${content.slice(0, MAX_EXTRACTION_RUN_CONTENT_BYTES)}\n...[truncated for Supabase storage limit]`
  }

  const { error } = await supabase.from('extraction_runs').upsert(
    {
      id: run.id,
      filename: run.filename,
      created_at: run.createdAt,
      user_email: run.userEmail ?? null,
      file_count: run.fileCount,
      success_count: run.successCount,
      error_count: run.errorCount,
      content,
      source: 'browser',
    },
    { onConflict: 'id' },
  )

  if (error) throw new Error(error.message)
}

async function getAuthenticatedUserId(
  supabase: NonNullable<Awaited<ReturnType<typeof getSupabaseClient>>>,
): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw new Error(error.message)
  if (!data.user) throw new Error('Sign in to Supabase before uploading files.')
  return data.user.id
}

export async function uploadExtractedModelFiles(
  run: SessionLogRecord,
  models: ProcessedModel[],
  onModelUploaded?: (uploadedModels: number) => void,
  shouldCancel?: ShouldCancelUpload,
): Promise<ModelUploadStorageResult> {
  const supabase = await getSupabaseClient()
  if (!supabase) {
    throw new Error('Supabase metadata store is unavailable')
  }

  let uploaded = 0
  let processedModels = 0
  let savedModelCount = 0
  const failures: UploadFailure[] = []
  const runFolder = `${formatStorageTimestamp(run.createdAt)}_${run.id.slice(0, 8)}`
  const userId = await getAuthenticatedUserId(supabase)

  await ensureExtractionRunForUpload(run)

  for (const model of models.filter((entry) => entry.status === 'done')) {
    if (shouldCancel?.()) break

    const modelBasePath = buildModelStorageRoot(runFolder, model)
    let modelZipPath: string | null = null
    const fileErrors: string[] = []

    try {
      const files = await buildFilesForModel(model)

      for (const file of files) {
        if (shouldCancel?.()) break

        const filename = sanitizePathPart(file.filename)
        const storagePath = `${modelBasePath}/${file.kind}/${filename}`

        try {
          const uploadedFile = await uploadR2File(
            storagePath,
            file.blob,
            file.blob.type || 'application/octet-stream',
          )

          const { error: metadataError } = await supabase.from('extracted_files').upsert(
            {
              run_id: run.id,
              user_email: run.userEmail ?? null,
              model_name: model.metadata.name || model.folderName,
              file_kind: file.kind,
              filename: file.filename,
              storage_bucket: r2BucketLabel(uploadedFile.bucket),
              storage_path: uploadedFile.storagePath,
              mime_type: uploadedFile.contentType || null,
              size_bytes: uploadedFile.sizeBytes,
            },
            { onConflict: 'storage_bucket,storage_path' },
          )

          if (metadataError) throw new Error(metadataError.message)

          if (file.kind === 'model_zip') modelZipPath = uploadedFile.storagePath
          uploaded += 1
        } catch (fileErr) {
          fileErrors.push(`${file.filename}: ${errorMessage(fileErr, 'upload failed')}`)
        }
      }

      // Only register the model once its archive is actually stored, otherwise the
      // hash-based duplicate check would block a retry of a model that has no data.
      if (model.fileHash && modelZipPath) {
        const { error: modelError } = await supabase.from('extracted_models').upsert(
          {
            run_id: run.id,
            user_id: userId,
            user_email: run.userEmail ?? null,
            model_name: model.metadata.name || model.folderName,
            original_filename: model.originalFilename,
            file_hash: model.fileHash,
            folder_name: model.folderName,
            original_size_bytes: model.originalSizeBytes,
            extracted_size_bytes: model.extractedSizeBytes,
            element_count: model.summary.elementCount,
            bone_count: model.summary.boneCount,
            texture_count: model.summary.textureCount,
            animation_count: model.summary.animationCount,
            model_zip_path: modelZipPath,
          },
          { onConflict: 'file_hash' },
        )

        if (modelError) {
          fileErrors.push(`model record: ${modelError.message}`)
        } else {
          savedModelCount += 1
        }
      } else if (!modelZipPath) {
        fileErrors.push('model archive was not stored, so the model was not registered')
      }
    } catch (modelErr) {
      fileErrors.push(errorMessage(modelErr, 'Unknown storage error'))
    }

    if (fileErrors.length > 0) {
      failures.push({ name: model.originalFilename, message: fileErrors.join('; ') })
    }

    processedModels += 1
    onModelUploaded?.(processedModels)
  }

  window.dispatchEvent(new CustomEvent('bbextract:storage-updated'))
  return { uploadedCount: uploaded, metadataSaved: true, failures, savedModelCount }
}

export interface UploadedDirectAsset {
  item: DirectUploadAssetItem
  storagePath: string
}

export interface UploadFailure {
  name: string
  message: string
}

export interface UploadStorageResult {
  uploadedCount: number
  metadataSaved: boolean
  failures: UploadFailure[]
}

export interface ModelUploadStorageResult extends UploadStorageResult {
  savedModelCount: number
}

export async function uploadDirectAssetFiles(
  run: SessionLogRecord,
  assets: DirectUploadAssetItem[],
  models: ProcessedModel[] = [],
  onUploaded?: (asset: UploadedDirectAsset) => void,
  onSettled?: () => void,
  shouldCancel?: ShouldCancelUpload,
): Promise<UploadStorageResult> {
  if (assets.length === 0) return { uploadedCount: 0, metadataSaved: true, failures: [] }

  const supabase = await getSupabaseClient()
  if (!supabase) {
    throw new Error('Supabase metadata store is unavailable')
  }

  const runFolder = `${formatStorageTimestamp(run.createdAt)}_${run.id.slice(0, 8)}`
  const failures: UploadFailure[] = []
  let uploaded = 0

  await ensureExtractionRunForUpload(run)

  for (const asset of assets) {
    if (shouldCancel?.()) break

    const { storagePath, modelName } = buildGroupedAssetLocation(runFolder, asset, models)
    const contentType = asset.file.type || 'application/octet-stream'

    try {
      const uploadedFile = await uploadR2File(storagePath, asset.file, contentType)

      const { error: metadataError } = await supabase.from('extracted_files').upsert(
        {
          run_id: run.id,
          user_email: run.userEmail ?? null,
          model_name: modelName,
          file_kind: asset.assetKind,
          filename: asset.file.name,
          storage_bucket: r2BucketLabel(uploadedFile.bucket),
          storage_path: uploadedFile.storagePath,
          mime_type: uploadedFile.contentType,
          size_bytes: uploadedFile.sizeBytes,
        },
        { onConflict: 'storage_bucket,storage_path' },
      )

      if (metadataError) throw new Error(metadataError.message)
      uploaded += 1
      onUploaded?.({ item: asset, storagePath: uploadedFile.storagePath })
    } catch (err) {
      failures.push({ name: asset.file.name, message: errorMessage(err, 'upload failed') })
    } finally {
      onSettled?.()
    }
  }

  window.dispatchEvent(new CustomEvent('bbextract:storage-updated'))
  return { uploadedCount: uploaded, metadataSaved: true, failures }
}

async function listStoredFileRows(limit: number): Promise<StoredExtractedFile[]> {
  const supabase = await getSupabaseClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('extracted_files')
    .select(
      'id, run_id, user_email, model_name, file_kind, filename, storage_bucket, storage_path, mime_type, size_bytes, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)
  return (data as ExtractedFileRow[]).map(rowToStoredFile)
}

export interface StorageUsage {
  usedBytes: number
  fileCount: number
  modelCount: number
  textureCount: number
  animationCount: number
  elementCount: number
  boneCount: number
  jsonCount: number
  geometryCount: number
  metadataCount: number
  summaryCount: number
  rawModelCount: number
}

const EMPTY_STORAGE_USAGE: StorageUsage = {
  usedBytes: 0,
  fileCount: 0,
  modelCount: 0,
  textureCount: 0,
  animationCount: 0,
  elementCount: 0,
  boneCount: 0,
  jsonCount: 0,
  geometryCount: 0,
  metadataCount: 0,
  summaryCount: 0,
  rawModelCount: 0,
}

function parseStorageUsageRow(row: {
  used_bytes?: number | string | null
  file_count?: number | string | null
  texture_count?: number | string | null
  animation_count?: number | string | null
  model_count?: number | string | null
  element_count?: number | string | null
  bone_count?: number | string | null
  json_count?: number | string | null
  geometry_count?: number | string | null
  metadata_count?: number | string | null
  summary_count?: number | string | null
  raw_model_count?: number | string | null
}): StorageUsage {
  return {
    usedBytes: Number(row.used_bytes ?? 0),
    fileCount: Number(row.file_count ?? 0),
    textureCount: Number(row.texture_count ?? 0),
    animationCount: Number(row.animation_count ?? 0),
    modelCount: Number(row.model_count ?? 0),
    elementCount: Number(row.element_count ?? 0),
    boneCount: Number(row.bone_count ?? 0),
    jsonCount: Number(row.json_count ?? 0),
    geometryCount: Number(row.geometry_count ?? 0),
    metadataCount: Number(row.metadata_count ?? 0),
    summaryCount: Number(row.summary_count ?? 0),
    rawModelCount: Number(row.raw_model_count ?? 0),
  }
}

function mergeStorageUsage(primary: StorageUsage, fallback: StorageUsage): StorageUsage {
  return {
    usedBytes: Math.max(primary.usedBytes, fallback.usedBytes),
    fileCount: Math.max(primary.fileCount, fallback.fileCount),
    modelCount: Math.max(primary.modelCount, fallback.modelCount),
    textureCount: Math.max(primary.textureCount, fallback.textureCount),
    animationCount: Math.max(primary.animationCount, fallback.animationCount),
    elementCount: Math.max(primary.elementCount, fallback.elementCount),
    boneCount: Math.max(primary.boneCount, fallback.boneCount),
    jsonCount: Math.max(primary.jsonCount, fallback.jsonCount),
    geometryCount: Math.max(primary.geometryCount, fallback.geometryCount),
    metadataCount: Math.max(primary.metadataCount, fallback.metadataCount),
    summaryCount: Math.max(primary.summaryCount, fallback.summaryCount),
    rawModelCount: Math.max(primary.rawModelCount, fallback.rawModelCount),
  }
}

async function countStoredModelsPaginated(): Promise<number> {
  const supabase = await getSupabaseClient()
  if (!supabase) return 0

  const pageSize = 1000
  let offset = 0
  let modelCount = 0

  while (true) {
    const { data, error } = await supabase
      .from('extracted_models')
      .select('id')
      .range(offset, offset + pageSize - 1)

    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break

    modelCount += data.length
    if (data.length < pageSize) break
    offset += pageSize
  }

  return modelCount
}

async function countStoredModelZipFilesPaginated(): Promise<number> {
  const supabase = await getSupabaseClient()
  if (!supabase) return 0

  const pageSize = 1000
  let offset = 0
  let modelZipCount = 0

  while (true) {
    const { data, error } = await supabase
      .from('extracted_files')
      .select('id')
      .eq('file_kind', 'model_zip')
      .range(offset, offset + pageSize - 1)

    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break

    modelZipCount += data.length
    if (data.length < pageSize) break
    offset += pageSize
  }

  return modelZipCount
}

/** Backfill extracted_models rows for model archives already stored in extracted_files. */
export async function repairExtractedModelsRegistry(): Promise<number> {
  const supabase = await getSupabaseClient()
  if (!supabase) return 0

  const userId = await getAuthenticatedUserId(supabase).catch(() => null)
  if (!userId) return 0

  let repaired = 0
  let offset = 0
  const pageSize = 500

  while (true) {
    const { data, error } = await supabase
      .from('extracted_files')
      .select('run_id, user_email, model_name, filename, storage_path')
      .eq('file_kind', 'model_zip')
      .range(offset, offset + pageSize - 1)

    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break

    for (const row of data) {
      const { data: existing, error: lookupError } = await supabase
        .from('extracted_models')
        .select('id')
        .eq('model_zip_path', row.storage_path)
        .maybeSingle()

      if (lookupError) throw new Error(lookupError.message)
      if (existing) continue

      const { error: insertError } = await supabase.from('extracted_models').upsert(
        {
          run_id: row.run_id,
          user_id: userId,
          user_email: row.user_email,
          model_name: row.model_name,
          original_filename: row.filename,
          file_hash: `registry:${row.storage_path}`,
          folder_name: row.model_name,
          model_zip_path: row.storage_path,
        },
        { onConflict: 'file_hash' },
      )

      if (!insertError) repaired += 1
    }

    if (data.length < pageSize) break
    offset += pageSize
  }

  return repaired
}

async function sumModelRegistryStats(): Promise<Pick<StorageUsage, 'elementCount' | 'boneCount'>> {
  const supabase = await getSupabaseClient()
  if (!supabase) return { elementCount: 0, boneCount: 0 }

  const pageSize = 1000
  let offset = 0
  let elementCount = 0
  let boneCount = 0

  while (true) {
    const { data, error } = await supabase
      .from('extracted_models')
      .select('element_count, bone_count')
      .range(offset, offset + pageSize - 1)

    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break

    for (const row of data) {
      elementCount += row.element_count ?? 0
      boneCount += row.bone_count ?? 0
    }

    if (data.length < pageSize) break
    offset += pageSize
  }

  return { elementCount, boneCount }
}

async function sumStorageUsagePaginated(): Promise<StorageUsage> {
  const supabase = await getSupabaseClient()
  if (!supabase) return EMPTY_STORAGE_USAGE

  const pageSize = 1000
  let offset = 0
  let usedBytes = 0
  let fileCount = 0
  let textureCount = 0
  let animationCount = 0
  let jsonCount = 0
  let geometryCount = 0
  let metadataCount = 0
  let summaryCount = 0
  let rawModelCount = 0
  let modelZipCount = 0

  while (true) {
    const { data, error } = await supabase
      .from('extracted_files')
      .select('size_bytes, file_kind, storage_path')
      .range(offset, offset + pageSize - 1)

    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break

    for (const row of data) {
      fileCount += 1
      usedBytes += row.size_bytes ?? 0

      switch (row.file_kind) {
        case 'texture':
          textureCount += 1
          break
        case 'animation':
          animationCount += 1
          break
        case 'json':
          jsonCount += 1
          break
        case 'geometry':
          geometryCount += 1
          break
        case 'metadata':
          metadataCount += 1
          break
        case 'summary':
          summaryCount += 1
          break
        case 'raw_model':
          rawModelCount += 1
          break
        case 'model_zip':
          modelZipCount += 1
          break
        default:
          break
      }

      if (row.file_kind !== 'animation' && row.storage_path?.includes('/animation/')) {
        animationCount += 1
      }
    }

    if (data.length < pageSize) break
    offset += pageSize
  }

  const registryModelCount = await countStoredModelsPaginated()
  const registryStats = await sumModelRegistryStats()

  return {
    usedBytes,
    fileCount,
    textureCount,
    animationCount,
    jsonCount,
    geometryCount,
    metadataCount,
    summaryCount,
    rawModelCount,
    modelCount: Math.max(registryModelCount, modelZipCount),
    elementCount: registryStats.elementCount,
    boneCount: registryStats.boneCount,
  }
}

/** Totals from extracted_files / extracted_models (database source of truth). */
export async function getStorageUsage(): Promise<StorageUsage> {
  const supabase = await getSupabaseClient()
  if (!supabase) return EMPTY_STORAGE_USAGE

  let usage = await sumStorageUsagePaginated()

  const registryModelCount = await countStoredModelsPaginated()
  const modelZipCount = await countStoredModelZipFilesPaginated()
  if (registryModelCount < modelZipCount) {
    await repairExtractedModelsRegistry()
    usage = await sumStorageUsagePaginated()
  }

  const { data, error } = await supabase.rpc('bbextract_storage_usage')
  if (!error && data) {
    const row = (Array.isArray(data) ? data[0] : data) as
      | {
          used_bytes?: number | string | null
          file_count?: number | string | null
          texture_count?: number | string | null
          animation_count?: number | string | null
          model_count?: number | string | null
          element_count?: number | string | null
          bone_count?: number | string | null
          json_count?: number | string | null
          geometry_count?: number | string | null
          metadata_count?: number | string | null
          summary_count?: number | string | null
          raw_model_count?: number | string | null
        }
      | undefined

    if (row) {
      usage = mergeStorageUsage(parseStorageUsageRow(row), usage)
    }
  }

  return usage
}

export async function listStoredExtractedFiles(
  limit = 500,
  options: ListStoredFilesOptions = {},
): Promise<StoredExtractedFile[]> {
  let tableFiles: StoredExtractedFile[] = []
  try {
    tableFiles = await listStoredFileRows(limit)
  } catch (err) {
    console.warn('[BBExtract] Falling back to bucket listing:', err)
  }

  if (!options.verifyBucket && tableFiles.length > 0) {
    return tableFiles
  }

  const bucketFiles = await listBucketObjectsRecursive('', limit)
  if (!options.verifyBucket) return bucketFiles

  const bucketPaths = new Set(bucketFiles.map((file) => file.storagePath))
  const verifiedTableFiles = tableFiles.filter((file) => bucketPaths.has(file.storagePath))
  const tablePaths = new Set(verifiedTableFiles.map((file) => file.storagePath))
  const bucketOnlyFiles = bucketFiles.filter((file) => !tablePaths.has(file.storagePath))
  return [...verifiedTableFiles, ...bucketOnlyFiles]
}

async function listStoredModelRows(limit: number): Promise<StoredExtractedModel[]> {
  const supabase = await getSupabaseClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('extracted_models')
    .select(
      'id, run_id, user_email, model_name, original_filename, file_hash, folder_name, original_size_bytes, extracted_size_bytes, element_count, bone_count, texture_count, animation_count, model_zip_path, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)
  return (data as ExtractedModelRow[]).map(rowToStoredModel)
}

export async function listStoredExtractedModels(
  limit = 200,
  options: ListStoredFilesOptions = {},
): Promise<StoredExtractedModel[]> {
  try {
    const tableModels = await listStoredModelRows(limit)
    if (!options.verifyBucket && tableModels.length > 0) {
      return tableModels
    }
  } catch (err) {
    console.warn('[BBExtract] Falling back to bucket model listing:', err)
  }

  const bucketFiles = await listBucketObjectsRecursive('', limit)
  const bucketPaths = new Set(bucketFiles.map((file) => file.storagePath))
  const bucketModels = bucketFiles
    .filter((file) => file.fileKind === 'model_zip')
    .map((file) => ({
      id: `bucket-model:${file.storagePath}`,
      runId: file.runId,
      userEmail: file.userEmail,
      modelName: file.modelName,
      originalFilename: file.filename,
      fileHash: file.storagePath,
      folderName: file.modelName,
      originalSizeBytes: file.sizeBytes,
      extractedSizeBytes: file.sizeBytes,
      elementCount: null,
      boneCount: null,
      textureCount: null,
      animationCount: null,
      modelZipPath: file.storagePath,
      createdAt: file.createdAt,
    }))

  if (options.verifyBucket) {
    const tableModels = await listStoredModelRows(limit)
      .then((models) =>
        models.filter((model) => !model.modelZipPath || bucketPaths.has(model.modelZipPath)),
      )
      .catch(() => [])
    const tableZipPaths = new Set(tableModels.map((model) => model.modelZipPath).filter(Boolean))
    const bucketOnlyModels = bucketModels.filter((model) => !tableZipPaths.has(model.modelZipPath))
    return [...tableModels, ...bucketOnlyModels]
  }

  return bucketModels
}

export async function getStoredFilePreviewUrl(file: StoredExtractedFile): Promise<string | null> {
  if (file.fileKind !== 'texture') return null

  if (isR2StoredFile(file)) {
    const data = await downloadR2File(file.storagePath)
    return URL.createObjectURL(data)
  }

  const supabase = await getSupabaseClient()
  if (!supabase) return null

  const { data, error } = await supabase.storage.from(file.storageBucket).download(file.storagePath)
  if (error) return null
  return URL.createObjectURL(data)
}

export async function downloadStoredModelZip(model: StoredExtractedModel): Promise<void> {
  if (!model.modelZipPath) return

  const { saveAs } = await import('file-saver')
  try {
    const data = await downloadR2File(model.modelZipPath)
    saveAs(data, `${model.folderName || model.modelName}.zip`)
    void recordAuditEvent('downloaded_stored_model_zip', model.modelName, {
      originalFilename: model.originalFilename,
      storagePath: model.modelZipPath,
      storageProvider: 'r2',
    })
    return
  } catch {
    // Fall back for older rows that still point at Supabase Storage.
  }

  const supabase = await getSupabaseClient()
  if (!supabase) return

  const { data, error } = await supabase.storage
    .from(loadEnvSettings().storageBucket)
    .download(model.modelZipPath)

  if (error) throw new Error(error.message)

  saveAs(data, `${model.folderName || model.modelName}.zip`)
  void recordAuditEvent('downloaded_stored_model_zip', model.modelName, {
    originalFilename: model.originalFilename,
    storagePath: model.modelZipPath,
  })
}

export async function downloadStoredExtractedFile(file: StoredExtractedFile): Promise<void> {
  if (isR2StoredFile(file)) {
    const data = await downloadR2File(file.storagePath)
    const { saveAs } = await import('file-saver')
    saveAs(data, file.filename)
    void recordAuditEvent('downloaded_stored_file', file.filename, {
      modelName: file.modelName,
      fileKind: file.fileKind,
      storagePath: file.storagePath,
      storageProvider: 'r2',
    })
    return
  }

  const supabase = await getSupabaseClient()
  if (!supabase) return

  const { data, error } = await supabase.storage
    .from(file.storageBucket)
    .download(file.storagePath)

  if (error) throw new Error(error.message)

  const { saveAs } = await import('file-saver')
  saveAs(data, file.filename)
  void recordAuditEvent('downloaded_stored_file', file.filename, {
    modelName: file.modelName,
    fileKind: file.fileKind,
    storagePath: file.storagePath,
  })
}

export async function downloadStoredFolderZip(
  folderPath: string,
  files: StoredExtractedFile[],
): Promise<void> {
  const zip = new JSZip()
  const folderPrefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`
  const folderFiles = files.filter((file) => file.storagePath.startsWith(folderPrefix))
  const needsSupabase = folderFiles.some((file) => !isR2StoredFile(file))
  const supabase = needsSupabase ? await getSupabaseClient() : null
  if (needsSupabase && !supabase) return

  for (const file of folderFiles) {
    const data = isR2StoredFile(file)
      ? await downloadR2File(file.storagePath)
      : await supabase!.storage.from(file.storageBucket).download(file.storagePath).then((result) => {
          if (result.error) throw new Error(result.error.message)
          return result.data
        })
    zip.file(file.storagePath.slice(folderPrefix.length), data)
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  const { saveAs } = await import('file-saver')
  saveAs(blob, `${sanitizePathPart(filenameFromPath(folderPath) || 'folder')}.zip`)
  void recordAuditEvent('downloaded_stored_folder_zip', folderPath, {
    fileCount: folderFiles.length,
  })
}

export async function renameStoredFile(file: StoredExtractedFile, nextName: string): Promise<void> {
  if (isR2StoredFile(file)) {
    throw new Error('R2-backed files cannot be renamed from the app yet.')
  }

  const supabase = await getSupabaseClient()
  if (!supabase) return

  const cleanName = sanitizePathPart(nextName)
  const nextPath = joinPath(dirname(file.storagePath), cleanName)
  if (!cleanName || nextPath === file.storagePath) return

  const { error: moveError } = await supabase.storage
    .from(file.storageBucket)
    .move(file.storagePath, nextPath)
  if (moveError) throw new Error(moveError.message)

  const { error: fileError } = await supabase
    .from('extracted_files')
    .update({ filename: cleanName, storage_path: nextPath })
    .eq('storage_bucket', file.storageBucket)
    .eq('storage_path', file.storagePath)
  if (fileError) throw new Error(fileError.message)

  if (file.fileKind === 'model_zip') {
    const { error: modelError } = await supabase
      .from('extracted_models')
      .update({ model_zip_path: nextPath })
      .eq('model_zip_path', file.storagePath)
    if (modelError) throw new Error(modelError.message)
  }

  window.dispatchEvent(new CustomEvent('bbextract:storage-updated'))
}

export async function renameStoredFolder(
  folderPath: string,
  nextName: string,
  files: StoredExtractedFile[],
): Promise<void> {
  if (files.some((file) => file.storagePath.startsWith(`${folderPath}/`) && isR2StoredFile(file))) {
    throw new Error('R2-backed folders cannot be renamed from the app yet.')
  }

  const supabase = await getSupabaseClient()
  if (!supabase) return

  const cleanName = sanitizePathPart(nextName)
  if (!cleanName) return

  const parent = dirname(folderPath)
  const nextFolderPath = joinPath(parent, cleanName)
  if (nextFolderPath === folderPath) return

  const folderPrefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`
  const matchingFiles = files.filter((file) => file.storagePath.startsWith(folderPrefix))

  for (const file of matchingFiles) {
    const nextPath = joinPath(nextFolderPath, file.storagePath.slice(folderPrefix.length))
    const { error: moveError } = await supabase.storage
      .from(file.storageBucket)
      .move(file.storagePath, nextPath)
    if (moveError) throw new Error(moveError.message)

    const { error: fileError } = await supabase
      .from('extracted_files')
      .update({ storage_path: nextPath })
      .eq('storage_bucket', file.storageBucket)
      .eq('storage_path', file.storagePath)
    if (fileError) throw new Error(fileError.message)

    if (file.fileKind === 'model_zip') {
      const { error: modelError } = await supabase
        .from('extracted_models')
        .update({ model_zip_path: nextPath })
        .eq('model_zip_path', file.storagePath)
      if (modelError) throw new Error(modelError.message)
    }
  }

  window.dispatchEvent(new CustomEvent('bbextract:storage-updated'))
}

function folderPrefix(folderPath: string): string {
  return folderPath.endsWith('/') ? folderPath : `${folderPath}/`
}

function filesInFolder(folderPath: string, files: StoredExtractedFile[]): StoredExtractedFile[] {
  const prefix = folderPrefix(folderPath)
  return files.filter((file) => file.storagePath.startsWith(prefix))
}

async function deleteExtractedFileMetadata(
  supabase: NonNullable<Awaited<ReturnType<typeof getSupabaseClient>>>,
  file: Pick<StoredExtractedFile, 'storageBucket' | 'storagePath' | 'fileKind'>,
): Promise<void> {
  const { error: fileError } = await supabase
    .from('extracted_files')
    .delete()
    .eq('storage_bucket', file.storageBucket)
    .eq('storage_path', file.storagePath)
  if (fileError) throw new Error(fileError.message)

  if (file.fileKind === 'model_zip') {
    const { error: modelError } = await supabase
      .from('extracted_models')
      .delete()
      .eq('model_zip_path', file.storagePath)
    if (modelError) throw new Error(modelError.message)
  }
}

async function deleteExtractedFolderMetadata(
  supabase: NonNullable<Awaited<ReturnType<typeof getSupabaseClient>>>,
  folderPath: string,
): Promise<void> {
  const prefix = folderPrefix(folderPath)

  const { error: filesError } = await supabase
    .from('extracted_files')
    .delete()
    .like('storage_path', `${prefix}%`)
  if (filesError) throw new Error(filesError.message)

  const { error: modelsError } = await supabase
    .from('extracted_models')
    .delete()
    .like('model_zip_path', `${prefix}%`)
  if (modelsError) throw new Error(modelsError.message)
}

export async function deleteStoredFile(file: StoredExtractedFile): Promise<void> {
  if (isR2StoredFile(file)) {
    await deleteR2File(file.storagePath)
  } else {
    const supabase = await getSupabaseClient()
    if (!supabase) throw new Error('Supabase is unavailable')
    const { error } = await supabase.storage.from(file.storageBucket).remove([file.storagePath])
    if (error) throw new Error(error.message)
  }

  const supabase = await getSupabaseClient()
  if (!supabase) throw new Error('Supabase metadata store is unavailable')
  await deleteExtractedFileMetadata(supabase, file)

  void recordAuditEvent('deleted_stored_file', file.filename, {
    modelName: file.modelName,
    fileKind: file.fileKind,
    storagePath: file.storagePath,
  })
  window.dispatchEvent(new CustomEvent('bbextract:storage-updated'))
}

export async function deleteStoredFolder(
  folderPath: string,
  files: StoredExtractedFile[],
): Promise<number> {
  const matchingFiles = filesInFolder(folderPath, files)
  const hasR2Files = matchingFiles.some(isR2StoredFile)
  const legacyFiles = matchingFiles.filter((file) => !isR2StoredFile(file))

  if (hasR2Files) {
    await deleteR2Prefix(folderPath)
  }

  if (legacyFiles.length > 0) {
    const supabase = await getSupabaseClient()
    if (!supabase) throw new Error('Supabase is unavailable')
    const { error } = await supabase.storage
      .from(legacyFiles[0].storageBucket)
      .remove(legacyFiles.map((file) => file.storagePath))
    if (error) throw new Error(error.message)
  }

  const supabase = await getSupabaseClient()
  if (!supabase) throw new Error('Supabase metadata store is unavailable')
  await deleteExtractedFolderMetadata(supabase, folderPath)

  void recordAuditEvent('deleted_stored_folder', folderPath, {
    fileCount: matchingFiles.length,
  })
  window.dispatchEvent(new CustomEvent('bbextract:storage-updated'))
  return matchingFiles.length
}

export async function readStoredTextFile(file: StoredExtractedFile): Promise<string> {
  if (!isEditableStoredFile(file)) {
    throw new Error('Only text and JSON files can be edited.')
  }

  if (isR2StoredFile(file)) {
    const data = await downloadR2File(file.storagePath)
    if (data.size > 1024 * 1024 * 2) throw new Error('File is too large to edit in the browser.')
    return data.text()
  }

  const supabase = await getSupabaseClient()
  if (!supabase) return ''

  const { data, error } = await supabase.storage.from(file.storageBucket).download(file.storagePath)
  if (error) throw new Error(error.message)
  if (data.size > 1024 * 1024 * 2) throw new Error('File is too large to edit in the browser.')
  return data.text()
}

export async function saveStoredTextFile(file: StoredExtractedFile, content: string): Promise<void> {
  if (!isEditableStoredFile(file)) {
    throw new Error('Only text and JSON files can be edited.')
  }

  if (isR2StoredFile(file)) {
    const blob = new Blob([content], { type: file.mimeType || 'text/plain;charset=utf-8' })
    await uploadR2File(file.storagePath, blob, blob.type)

    const supabase = await getSupabaseClient()
    if (supabase) {
      const { error: metadataError } = await supabase
        .from('extracted_files')
        .update({ mime_type: blob.type, size_bytes: blob.size })
        .eq('storage_bucket', file.storageBucket)
        .eq('storage_path', file.storagePath)
      if (metadataError) throw new Error(metadataError.message)
    }

    window.dispatchEvent(new CustomEvent('bbextract:storage-updated'))
    return
  }

  const supabase = await getSupabaseClient()
  if (!supabase) return

  const blob = new Blob([content], { type: file.mimeType || 'text/plain;charset=utf-8' })
  const { error: uploadError } = await supabase.storage
    .from(file.storageBucket)
    .upload(file.storagePath, blob, {
      contentType: blob.type,
      upsert: true,
    })
  if (uploadError) throw new Error(uploadError.message)

  const { error: metadataError } = await supabase
    .from('extracted_files')
    .update({ mime_type: blob.type, size_bytes: blob.size })
    .eq('storage_bucket', file.storageBucket)
    .eq('storage_path', file.storagePath)
  if (metadataError) throw new Error(metadataError.message)

  window.dispatchEvent(new CustomEvent('bbextract:storage-updated'))
}
