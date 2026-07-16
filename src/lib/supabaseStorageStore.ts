import JSZip from 'jszip'
import { downloadR2File, uploadR2File } from './api'
import { buildModelZip } from './buildZip'
import { loadEnvSettings } from './envSettings'
import { modelDataStore } from './modelDataStore'
import { recordAuditEvent } from './auditLogStore'
import type { SessionLogRecord } from './sessionLogger'
import { getSupabaseClient } from './supabaseClient'
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

function archiveFolderName(asset: DirectUploadAssetItem): string {
  const sourceName = asset.sourceArchive?.replace(/\.zip$/i, '') || 'direct_assets'
  return sanitizePathPart(sourceName)
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

export async function uploadExtractedModelFiles(
  run: SessionLogRecord,
  models: ProcessedModel[],
): Promise<UploadStorageResult> {
  const supabase = await getSupabaseClient()
  if (!supabase) {
    throw new Error('Supabase metadata store is unavailable')
  }

  let uploaded = 0
  const runFolder = `${formatStorageTimestamp(run.createdAt)}_${run.id.slice(0, 8)}`

  for (const model of models.filter((entry) => entry.status === 'done')) {
    const files = await buildFilesForModel(model)
    const modelPath = sanitizePathPart(model.folderName)
    let modelZipPath: string | null = null

    for (const file of files) {
      const filename = sanitizePathPart(file.filename)
      const storagePath = `${runFolder}/${modelPath}/${file.kind}/${filename}`
      if (file.kind === 'model_zip') modelZipPath = storagePath

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
      uploaded += 1
    }

    if (model.fileHash) {
      const { error: modelError } = await supabase.from('extracted_models').upsert(
        {
          run_id: run.id,
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

      if (modelError) throw new Error(modelError.message)
    }
  }

  window.dispatchEvent(new CustomEvent('bbextract:storage-updated'))
  return { uploadedCount: uploaded, metadataSaved: true }
}

export interface UploadedDirectAsset {
  item: DirectUploadAssetItem
  storagePath: string
}

export interface UploadStorageResult {
  uploadedCount: number
  metadataSaved: boolean
}

export async function uploadDirectAssetFiles(
  run: SessionLogRecord,
  assets: DirectUploadAssetItem[],
  onUploaded?: (asset: UploadedDirectAsset) => void,
): Promise<UploadStorageResult> {
  if (assets.length === 0) return { uploadedCount: 0, metadataSaved: true }

  const supabase = await getSupabaseClient()
  if (!supabase) {
    throw new Error('Supabase metadata store is unavailable')
  }

  const runFolder = `${formatStorageTimestamp(run.createdAt)}_${run.id.slice(0, 8)}`
  let uploaded = 0

  for (const asset of assets) {
    const archivePath = archiveFolderName(asset)
    const filename = sanitizePathPart(asset.file.name)
    const storagePath = `${runFolder}/${archivePath}/${asset.assetKind}/${filename}`
    const contentType = asset.file.type || 'application/octet-stream'

    const uploadedFile = await uploadR2File(storagePath, asset.file, contentType)

    const { error: metadataError } = await supabase.from('extracted_files').upsert(
      {
        run_id: run.id,
        user_email: run.userEmail ?? null,
        model_name: archivePath,
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
  }

  window.dispatchEvent(new CustomEvent('bbextract:storage-updated'))
  return { uploadedCount: uploaded, metadataSaved: true }
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
