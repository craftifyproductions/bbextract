import { Readable } from 'node:stream'
import type { Request, Response } from 'express'
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import {
  MAX_R2_UPLOAD_BYTES,
  R2_ACCESS_KEY_ID,
  R2_BUCKET,
  R2_ENDPOINT,
  R2_PREFIX,
  R2_SECRET_ACCESS_KEY,
  R2_VECTOR_BUCKET,
  R2_VECTOR_PREFIX,
  isR2Configured,
  isR2VectorConfigured,
} from './config.js'

const STORAGE_PATH_RE = /^[\w./=-]+$/

let r2Client: S3Client | null = null

function getR2Client(): S3Client {
  if (!isR2Configured()) {
    throw new Error('Cloudflare R2 is not configured')
  }

  if (!r2Client) {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID!,
        secretAccessKey: R2_SECRET_ACCESS_KEY!,
      },
    })
  }

  return r2Client
}

function normalizeStoragePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.trim().replace(/^\/+/, '')
  if (!path || path.includes('..') || path.includes('//')) return null
  if (path.length > 1024 || !STORAGE_PATH_RE.test(path)) return null
  return path
}

function objectKey(storagePath: string): string {
  return [R2_PREFIX, storagePath].filter(Boolean).join('/').replace(/\/+/g, '/')
}

function headerString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export async function uploadR2FileHandler(req: Request, res: Response): Promise<void> {
  try {
    const storagePath = normalizeStoragePath(headerString(req.headers['x-bbextract-path']))
    if (!storagePath) {
      res.status(400).json({ error: 'Invalid storage path' })
      return
    }

    const contentLength = Number(req.headers['content-length'] ?? 0)
    if (contentLength <= 0) {
      res.status(400).json({ error: 'Empty upload body' })
      return
    }
    if (MAX_R2_UPLOAD_BYTES > 0 && contentLength > MAX_R2_UPLOAD_BYTES) {
      res.status(413).json({
        error: `Upload exceeds ${Math.round(MAX_R2_UPLOAD_BYTES / 1024 / 1024)} MB`,
      })
      return
    }

    const contentType =
      headerString(req.headers['x-bbextract-content-type']) || 'application/octet-stream'

    const upload = new Upload({
      client: getR2Client(),
      params: {
        Bucket: R2_BUCKET!,
        Key: objectKey(storagePath),
        Body: req,
        ContentType: contentType,
        ContentLength: contentLength,
      },
      queueSize: 2,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false,
    })
    await upload.done()

    res.json({
      ok: true,
      bucket: R2_BUCKET,
      storagePath,
      sizeBytes: contentLength,
      contentType,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to upload to R2'
    const status = isR2Configured() ? 500 : 503
    console.error('[BBExtract] R2 upload error:', err)
    res.status(status).json({ error: message })
  }
}

export async function healthR2Handler(_req: Request, res: Response): Promise<void> {
  try {
    if (!isR2Configured()) {
      res.status(503).json({
        ok: false,
        configured: false,
        error: 'Cloudflare R2 is not configured',
      })
      return
    }

    await getR2Client().send(new HeadBucketCommand({ Bucket: R2_BUCKET! }))

    res.json({
      ok: true,
      configured: true,
      bucket: R2_BUCKET,
      prefix: R2_PREFIX,
      maxUploadBytes: MAX_R2_UPLOAD_BYTES || undefined,
    })
  } catch (err) {
    console.error('[BBExtract] R2 health check error:', err)
    res.status(503).json({
      ok: false,
      configured: isR2Configured(),
      error: 'Cloudflare R2 health check failed',
    })
  }
}

async function deleteR2ObjectsByPrefix(prefix: string): Promise<number> {
  const client = getR2Client()
  const keyPrefix = objectKey(prefix.endsWith('/') ? prefix : `${prefix}/`)
  let deletedCount = 0
  let continuationToken: string | undefined

  do {
    const listing = await client.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET!,
        Prefix: keyPrefix,
        ContinuationToken: continuationToken,
      }),
    )

    const keys = (listing.Contents ?? [])
      .map((entry) => entry.Key)
      .filter((key): key is string => Boolean(key))

    if (keys.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: R2_BUCKET!,
          Delete: {
            Objects: keys.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      )
      deletedCount += keys.length
    }

    continuationToken = listing.IsTruncated ? listing.NextContinuationToken : undefined
  } while (continuationToken)

  return deletedCount
}

export async function deleteR2FileHandler(req: Request, res: Response): Promise<void> {
  try {
    const storagePath = normalizeStoragePath(req.query.path)
    if (!storagePath) {
      res.status(400).json({ error: 'Invalid storage path' })
      return
    }

    await getR2Client().send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET!,
        Key: objectKey(storagePath),
      }),
    )

    res.json({ ok: true, storagePath })
  } catch (err) {
    console.error('[BBExtract] R2 delete error:', err)
    res.status(isR2Configured() ? 500 : 503).json({
      error: err instanceof Error ? err.message : 'Failed to delete from R2',
    })
  }
}

export async function deleteR2PrefixHandler(req: Request, res: Response): Promise<void> {
  try {
    const prefix = normalizeStoragePath(req.query.prefix)
    if (!prefix) {
      res.status(400).json({ error: 'Invalid storage prefix' })
      return
    }

    const deletedCount = await deleteR2ObjectsByPrefix(prefix)
    res.json({ ok: true, prefix, deletedCount })
  } catch (err) {
    console.error('[BBExtract] R2 prefix delete error:', err)
    res.status(isR2Configured() ? 500 : 503).json({
      error: err instanceof Error ? err.message : 'Failed to delete from R2',
    })
  }
}

export async function downloadR2FileHandler(req: Request, res: Response): Promise<void> {
  try {
    const storagePath = normalizeStoragePath(req.query.path)
    if (!storagePath) {
      res.status(400).json({ error: 'Invalid storage path' })
      return
    }

    const result = await getR2Client().send(
      new GetObjectCommand({
        Bucket: R2_BUCKET!,
        Key: objectKey(storagePath),
      }),
    )

    if (result.ContentType) res.setHeader('Content-Type', result.ContentType)
    if (result.ContentLength != null) res.setHeader('Content-Length', String(result.ContentLength))

    const body = result.Body
    if (body instanceof Readable) {
      body.pipe(res)
      return
    }

    const bytes = await result.Body?.transformToByteArray()
    if (!bytes) {
      res.status(404).json({ error: 'File not found' })
      return
    }
    res.send(Buffer.from(bytes))
  } catch (err) {
    console.error('[BBExtract] R2 download error:', err)
    res.status(500).json({ error: 'Failed to download from R2' })
  }
}

/** Internal helpers for server-side batch jobs (not HTTP handlers). */

export async function listR2StoragePaths(prefix = ''): Promise<string[]> {
  const objects = await listR2Objects(prefix)
  return objects.map((item) => item.storagePath)
}

export interface R2ListedObject {
  storagePath: string
  sizeBytes: number
  lastModified: string | null
}

/** List R2 objects under prefix (storage paths relative to R2_PREFIX). */
export async function listR2Objects(prefix = '', maxKeys = 50_000): Promise<R2ListedObject[]> {
  if (!isR2Configured()) return []

  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, '')
  const keyPrefix = objectKey(cleanPrefix ? `${cleanPrefix}/` : '')
  const prefixRe = R2_PREFIX
    ? new RegExp(`^${R2_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`)
    : null
  const objects: R2ListedObject[] = []
  let continuationToken: string | undefined

  do {
    const result = await getR2Client().send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET!,
        Prefix: keyPrefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    )

    for (const item of result.Contents ?? []) {
      if (!item.Key || item.Key.endsWith('/')) continue
      const storagePath = prefixRe ? item.Key.replace(prefixRe, '') : item.Key
      if (!storagePath) continue
      objects.push({
        storagePath,
        sizeBytes: Number(item.Size ?? 0),
        lastModified: item.LastModified ? item.LastModified.toISOString() : null,
      })
      if (objects.length >= maxKeys) return objects
    }

    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined
  } while (continuationToken)

  return objects
}

export async function listR2Handler(req: Request, res: Response): Promise<void> {
  try {
    if (!isR2Configured()) {
      res.status(503).json({ error: 'Cloudflare R2 is not configured', files: [] })
      return
    }
    const requested = Number(req.query.limit ?? 20_000)
    const limit = Math.max(1, Math.min(Number.isFinite(requested) ? Math.floor(requested) : 20_000, 50_000))
    const prefix =
      typeof req.query.prefix === 'string' ? req.query.prefix.replace(/^\/+|\/+$/g, '') : ''
    const files = await listR2Objects(prefix, limit)
    res.json({
      ok: true,
      count: files.length,
      bucket: R2_BUCKET,
      files,
    })
  } catch (err) {
    console.error('[BBExtract] R2 list error:', err)
    res.status(500).json({ error: 'Failed to list R2 objects', files: [] })
  }
}

export async function getR2ObjectBuffer(storagePath: string): Promise<Buffer | null> {
  const normalized = normalizeStoragePath(storagePath)
  if (!normalized) throw new Error(`Invalid storage path: ${storagePath}`)

  try {
    const result = await getR2Client().send(
      new GetObjectCommand({
        Bucket: R2_BUCKET!,
        Key: objectKey(normalized),
      }),
    )
    const bytes = await result.Body?.transformToByteArray()
    return bytes ? Buffer.from(bytes) : null
  } catch (err) {
    const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : ''
    if (name === 'NoSuchKey' || name === 'NotFound') return null
    throw err
  }
}

export async function putR2ObjectBuffer(
  storagePath: string,
  body: Buffer,
  contentType: string,
): Promise<{ storagePath: string; sizeBytes: number }> {
  const normalized = normalizeStoragePath(storagePath)
  if (!normalized) throw new Error(`Invalid storage path: ${storagePath}`)
  if (MAX_R2_UPLOAD_BYTES > 0 && body.byteLength > MAX_R2_UPLOAD_BYTES) {
    throw new Error(`Upload exceeds ${Math.round(MAX_R2_UPLOAD_BYTES / 1024 / 1024)} MB`)
  }

  await getR2Client().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET!,
      Key: objectKey(normalized),
      Body: body,
      ContentType: contentType,
      ContentLength: body.byteLength,
    }),
  )

  return { storagePath: normalized, sizeBytes: body.byteLength }
}

function sanitizeVectorFolderName(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120)
  return cleaned || 'unnamed_model'
}

/**
 * Folder name for vector-db corpus.
 * Uses leaf model name + a short run/extract suffix so duplicate leaves
 * (e.g. many `enchanted_laser_gun2` extracts) do not overwrite each other.
 */
export function vectorFolderFromModelRoot(modelRoot: string, modelName?: string): string {
  const parts = modelRoot.split('/').filter(Boolean)
  const leaf = parts[parts.length - 1] || modelName || 'unnamed_model'
  const base = sanitizeVectorFolderName(modelName?.trim() ? modelName : leaf)
  const runId = parts[0] || ''
  // Prefer trailing uuid/hash segment from run folders like 2026-07-27_..._c6f0b745
  const runSuffix = (runId.split('_').filter(Boolean).pop() || runId).slice(-12)
  if (!runSuffix || runSuffix === base) return base
  return sanitizeVectorFolderName(`${base}__${runSuffix}`)
}

function vectorObjectKey(storagePath: string): string {
  return [R2_VECTOR_PREFIX, storagePath].filter(Boolean).join('/').replace(/\/+/g, '/')
}

/**
 * Write RAG corpus files into the vector-db bucket.
 * Layout: `{modelFolder}/model.json` and `{modelFolder}/label.json`
 */
export async function putR2VectorObjectBuffer(
  storagePath: string,
  body: Buffer,
  contentType: string,
): Promise<{ bucket: string; storagePath: string; sizeBytes: number }> {
  if (!isR2VectorConfigured()) {
    throw new Error('R2 vector bucket is not configured (R2_VECTOR_BUCKET)')
  }
  const normalized = normalizeStoragePath(storagePath)
  if (!normalized) throw new Error(`Invalid vector storage path: ${storagePath}`)
  if (MAX_R2_UPLOAD_BYTES > 0 && body.byteLength > MAX_R2_UPLOAD_BYTES) {
    throw new Error(`Upload exceeds ${Math.round(MAX_R2_UPLOAD_BYTES / 1024 / 1024)} MB`)
  }

  await getR2Client().send(
    new PutObjectCommand({
      Bucket: R2_VECTOR_BUCKET,
      Key: vectorObjectKey(normalized),
      Body: body,
      ContentType: contentType,
      ContentLength: body.byteLength,
    }),
  )

  return {
    bucket: R2_VECTOR_BUCKET,
    storagePath: normalized,
    sizeBytes: body.byteLength,
  }
}

export async function getR2VectorObjectBuffer(storagePath: string): Promise<Buffer | null> {
  if (!isR2VectorConfigured()) return null
  const normalized = normalizeStoragePath(storagePath)
  if (!normalized) throw new Error(`Invalid vector storage path: ${storagePath}`)

  try {
    const result = await getR2Client().send(
      new GetObjectCommand({
        Bucket: R2_VECTOR_BUCKET,
        Key: vectorObjectKey(normalized),
      }),
    )
    const bytes = await result.Body?.transformToByteArray()
    return bytes ? Buffer.from(bytes) : null
  } catch (err) {
    const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : ''
    if (name === 'NoSuchKey' || name === 'NotFound') return null
    throw err
  }
}

/** List vector-db object keys (paths relative to R2_VECTOR_PREFIX). */
export async function listR2VectorStoragePaths(prefix = '', maxKeys = 50_000): Promise<string[]> {
  if (!isR2VectorConfigured()) return []

  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, '')
  const keyPrefix = vectorObjectKey(cleanPrefix ? `${cleanPrefix}/` : '')
  const prefixRe = R2_VECTOR_PREFIX
    ? new RegExp(`^${R2_VECTOR_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`)
    : null
  const paths: string[] = []
  let continuationToken: string | undefined

  do {
    const result = await getR2Client().send(
      new ListObjectsV2Command({
        Bucket: R2_VECTOR_BUCKET,
        Prefix: keyPrefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    )

    for (const item of result.Contents ?? []) {
      if (!item.Key || item.Key.endsWith('/')) continue
      const storagePath = prefixRe ? item.Key.replace(prefixRe, '') : item.Key
      if (!storagePath) continue
      paths.push(storagePath)
      if (paths.length >= maxKeys) return paths
    }

    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined
  } while (continuationToken)

  return paths
}

function textureExtension(mimeType: string, filename?: string): string {
  const fromName = filename?.toLowerCase().match(/\.(png|jpe?g|webp)$/)?.[0]
  if (fromName) return fromName
  if (mimeType.includes('webp')) return '.webp'
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return '.jpg'
  return '.png'
}

/**
 * Upload RAG pack into vector-db/{folder}/:
 *   model.json, label.json, texture.(png|jpg|webp), meta.json
 */
export async function syncModelToVectorBucket(opts: {
  folderName: string
  modelJson: unknown
  labelJson: unknown
  texture?: { bytes: Buffer; mimeType: string; filename?: string } | null
  meta?: Record<string, unknown> | null
}): Promise<{ folder: string; paths: string[] }> {
  const folder = sanitizeVectorFolderName(opts.folderName)
  const paths: string[] = []

  const textureFile = opts.texture?.bytes?.byteLength
    ? `texture${textureExtension(opts.texture.mimeType, opts.texture.filename)}`
    : null

  const labelRecord: Record<string, unknown> =
    opts.labelJson && typeof opts.labelJson === 'object' && !Array.isArray(opts.labelJson)
      ? { ...(opts.labelJson as Record<string, unknown>) }
      : { value: opts.labelJson }

  if (textureFile) {
    const prevAssets =
      labelRecord._assets && typeof labelRecord._assets === 'object'
        ? (labelRecord._assets as Record<string, unknown>)
        : {}
    labelRecord._assets = {
      ...prevAssets,
      texture: textureFile,
    }
  }

  const modelPath = `${folder}/model.json`
  const labelPath = `${folder}/label.json`
  await putR2VectorObjectBuffer(
    modelPath,
    Buffer.from(`${JSON.stringify(opts.modelJson, null, 2)}\n`, 'utf8'),
    'application/json',
  )
  paths.push(modelPath)
  await putR2VectorObjectBuffer(
    labelPath,
    Buffer.from(`${JSON.stringify(labelRecord, null, 2)}\n`, 'utf8'),
    'application/json',
  )
  paths.push(labelPath)

  if (opts.texture?.bytes?.byteLength && textureFile) {
    const texturePath = `${folder}/${textureFile}`
    await putR2VectorObjectBuffer(texturePath, opts.texture.bytes, opts.texture.mimeType)
    paths.push(texturePath)
  }

  const labelVersion =
    typeof labelRecord.label_schema_version === 'number'
      ? labelRecord.label_schema_version
      : typeof (opts.meta as { label_schema_version?: unknown } | null | undefined)
            ?.label_schema_version === 'number'
        ? (opts.meta as { label_schema_version: number }).label_schema_version
        : null

  const meta = {
    folder,
    texture_file: textureFile,
    embedding_field: 'embedding_text',
    has_model_json: true,
    has_label_json: true,
    has_texture: Boolean(textureFile),
    ...(labelVersion != null ? { label_schema_version: labelVersion } : {}),
    ...(opts.meta ?? {}),
  }
  const metaPath = `${folder}/meta.json`
  await putR2VectorObjectBuffer(
    metaPath,
    Buffer.from(`${JSON.stringify(meta, null, 2)}\n`, 'utf8'),
    'application/json',
  )
  paths.push(metaPath)

  return { folder, paths }
}
