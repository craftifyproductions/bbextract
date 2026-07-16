import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Request, Response } from 'express'
import { LOGS_DIR, MAX_LOGS } from './config.js'

export interface LogMeta {
  id: string
  filename: string
  createdAt: string
  userEmail?: string
  fileCount: number
  successCount: number
  errorCount: number
}

export interface LogRecord extends LogMeta {
  content: string
}

const MANIFEST = 'manifest.json'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LOG_FILENAME_RE = /^bbextract-[\w.-]+\.log$/i
const MAX_LOG_CONTENT_BYTES = 5 * 1024 * 1024

function isValidLogId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id)
}

function normalizeLogFilename(filename: unknown): string | null {
  if (typeof filename !== 'string') return null
  const safe = basename(filename)
  return LOG_FILENAME_RE.test(safe) ? safe : null
}

function escapeHeaderFilename(filename: string): string {
  return filename.replace(/["\\\r\n]/g, '_')
}

async function ensureLogsDir(): Promise<void> {
  await mkdir(LOGS_DIR, { recursive: true })
}

async function readManifest(): Promise<LogMeta[]> {
  await ensureLogsDir()
  try {
    const raw = await readFile(join(LOGS_DIR, MANIFEST), 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as LogMeta[]) : []
  } catch {
    return []
  }
}

async function writeManifest(entries: LogMeta[]): Promise<void> {
  const sorted = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const keep = sorted.slice(0, MAX_LOGS)
  const remove = sorted.slice(MAX_LOGS)

  for (const entry of remove) {
    try {
      await unlink(join(LOGS_DIR, entry.filename))
    } catch {
      // file may already be gone
    }
  }

  await writeFile(join(LOGS_DIR, MANIFEST), JSON.stringify(keep, null, 2), 'utf-8')
}

export async function listLogsHandler(_req: Request, res: Response): Promise<void> {
  try {
    const manifest = await readManifest()
    res.json(manifest)
  } catch (err) {
    console.error('[BBExtract] list logs error:', err)
    res.status(500).json({ error: 'Failed to list logs' })
  }
}

export async function saveLogHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as Partial<LogRecord>
    const filename = normalizeLogFilename(body.filename)
    if (
      !isValidLogId(body.id) ||
      !filename ||
      !body.createdAt ||
      typeof body.content !== 'string' ||
      Buffer.byteLength(body.content, 'utf-8') > MAX_LOG_CONTENT_BYTES
    ) {
      res.status(400).json({ error: 'Invalid log payload' })
      return
    }

    await ensureLogsDir()

    const meta: LogMeta = {
      id: body.id,
      filename,
      createdAt: body.createdAt,
      userEmail: typeof body.userEmail === 'string' ? body.userEmail : undefined,
      fileCount: body.fileCount ?? 0,
      successCount: body.successCount ?? 0,
      errorCount: body.errorCount ?? 0,
    }

    await writeFile(join(LOGS_DIR, meta.filename), body.content, 'utf-8')

    const manifest = await readManifest()
    const updated = [meta, ...manifest.filter((entry) => entry.id !== meta.id)]
    await writeManifest(updated)

    res.json({ ok: true, log: meta })
  } catch (err) {
    console.error('[BBExtract] save log error:', err)
    res.status(500).json({ error: 'Failed to save log' })
  }
}

export async function downloadLogHandler(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id
    if (!isValidLogId(id)) {
      res.status(400).json({ error: 'Invalid log id' })
      return
    }

    const manifest = await readManifest()
    const entry = manifest.find((log) => log.id === id)

    if (!entry) {
      res.status(404).json({ error: 'Log not found' })
      return
    }

    const content = await readFile(join(LOGS_DIR, entry.filename), 'utf-8')
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${escapeHeaderFilename(entry.filename)}"`)
    res.send(content)
  } catch (err) {
    console.error('[BBExtract] download log error:', err)
    res.status(500).json({ error: 'Failed to download log' })
  }
}

export async function getLogContentHandler(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id
    if (!isValidLogId(id)) {
      res.status(400).json({ error: 'Invalid log id' })
      return
    }

    const manifest = await readManifest()
    const entry = manifest.find((log) => log.id === id)

    if (!entry) {
      res.status(404).json({ error: 'Log not found' })
      return
    }

    const content = await readFile(join(LOGS_DIR, entry.filename), 'utf-8')
    res.json({ ...entry, content })
  } catch (err) {
    console.error('[BBExtract] get log error:', err)
    res.status(500).json({ error: 'Failed to read log' })
  }
}

/** Rebuild manifest from .log files on disk (startup helper). */
export async function syncManifestFromDisk(): Promise<void> {
  await ensureLogsDir()
  const existing = await readManifest()
  if (existing.length > 0) return

  const files = await readdir(LOGS_DIR)
  const logFiles = files.filter((f) => f.endsWith('.log')).sort().reverse()
  if (logFiles.length === 0) return

  const entries: LogMeta[] = logFiles.slice(0, MAX_LOGS).map((filename) => ({
    id: filename.replace(/\.log$/, ''),
    filename,
    createdAt: new Date().toISOString(),
    fileCount: 0,
    successCount: 0,
    errorCount: 0,
  }))

  await writeManifest(entries)
}
