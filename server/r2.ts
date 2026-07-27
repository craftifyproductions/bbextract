import { Readable } from 'node:stream'
import type { Request, Response } from 'express'
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
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
  isR2Configured,
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
