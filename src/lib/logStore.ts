import { saveAs } from 'file-saver'
import {
  ApiError,
  fetchLogContent,
  fetchLogs,
  getLogDownloadUrl,
  saveLog,
} from './api'
import { isSupabaseConfigured } from './envSettings'
import type { SessionLogRecord } from './sessionLogger'
import { getLogFromSupabase, listLogsFromSupabase, saveLogToSupabase } from './supabaseLogStore'

const DB_NAME = 'bbextract'
const DB_VERSION = 1
const STORE_NAME = 'logs'
export const MAX_LOG_COUNT = 5

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error ?? new Error('Failed to open log database'))
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }
  })

  return dbPromise
}

export function selectLogsToKeep(
  logs: SessionLogRecord[],
  max = MAX_LOG_COUNT,
): SessionLogRecord[] {
  return [...logs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, max)
}

export function selectLogsToDelete(
  allLogs: SessionLogRecord[],
  keep: SessionLogRecord[],
): SessionLogRecord[] {
  const keepIds = new Set(keep.map((log) => log.id))
  return allLogs.filter((log) => !keepIds.has(log.id))
}

async function getAllLogsLocal(db: IDBDatabase): Promise<SessionLogRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()

    request.onerror = () => reject(request.error ?? new Error('Failed to read logs'))
    request.onsuccess = () => resolve((request.result as SessionLogRecord[]) ?? [])
  })
}

async function putLogLocal(db: IDBDatabase, log: SessionLogRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.put(log)

    request.onerror = () => reject(request.error ?? new Error('Failed to save log'))
    request.onsuccess = () => resolve()
  })
}

async function deleteLogLocal(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.delete(id)

    request.onerror = () => reject(request.error ?? new Error('Failed to delete log'))
    request.onsuccess = () => resolve()
  })
}

async function saveSessionLogLocal(log: SessionLogRecord): Promise<void> {
  const db = await openDb()
  const existing = await getAllLogsLocal(db)
  const withNew = existing.some((entry) => entry.id === log.id)
    ? existing.map((entry) => (entry.id === log.id ? log : entry))
    : [...existing, log]

  const keep = selectLogsToKeep(withNew)
  const remove = selectLogsToDelete(withNew, keep)

  await putLogLocal(db, log)
  for (const stale of remove) {
    await deleteLogLocal(db, stale.id)
  }
}

export function mergeSessionLogLists(
  serverLogs: SessionLogRecord[],
  localLogs: SessionLogRecord[],
  max = MAX_LOG_COUNT,
): SessionLogRecord[] {
  const byId = new Map<string, SessionLogRecord>()

  for (const log of localLogs) {
    byId.set(log.id, log)
  }

  for (const log of serverLogs) {
    const existing = byId.get(log.id)
    byId.set(
      log.id,
      existing
        ? { ...existing, ...log, content: existing.content || log.content }
        : { ...log, content: log.content ?? '' },
    )
  }

  return selectLogsToKeep([...byId.values()], max)
}

async function readLocalSessionLogs(): Promise<SessionLogRecord[]> {
  const db = await openDb()
  return selectLogsToKeep(await getAllLogsLocal(db))
}

export type LogPersistTarget = 'supabase' | 'server' | 'local'

/** Persist log to Supabase (when configured), server (when authed), and always keep a local copy. */
export async function saveSessionLog(
  log: SessionLogRecord,
  authenticated: boolean,
): Promise<LogPersistTarget> {
  let primary: LogPersistTarget = 'local'

  if (isSupabaseConfigured()) {
    try {
      await saveLogToSupabase(log)
      primary = 'supabase'
    } catch (err) {
      console.warn('[BBExtract] Supabase log save failed:', err)
    }
  }

  if (authenticated && !isSupabaseConfigured()) {
    try {
      await saveLog(log)
      if (primary === 'local') primary = 'server'
    } catch (err) {
      console.warn('[BBExtract] Server log save failed, falling back to local storage:', err)
    }
  }

  await saveSessionLogLocal(log)
  return primary
}

export async function listSessionLogs(authenticated: boolean): Promise<SessionLogRecord[]> {
  const localLogs = await readLocalSessionLogs()

  let remoteLogs: SessionLogRecord[] = []

  if (isSupabaseConfigured()) {
    try {
      remoteLogs = await listLogsFromSupabase()
    } catch (err) {
      console.warn('[BBExtract] Failed to fetch Supabase logs:', err)
    }
  } else if (authenticated) {
    try {
      remoteLogs = (await fetchLogs()) as SessionLogRecord[]
    } catch (err) {
      console.warn('[BBExtract] Failed to fetch server logs:', err)
    }
  }

  if (remoteLogs.length === 0) return localLogs
  return mergeSessionLogLists(remoteLogs, localLogs, isSupabaseConfigured() ? 50 : MAX_LOG_COUNT)
}

export async function getSessionLog(
  id: string,
  authenticated: boolean,
): Promise<SessionLogRecord | null> {
  const db = await openDb()
  const local = await getAllLogsLocal(db)
  const localMatch = local.find((log) => log.id === id)
  if (localMatch?.content) return localMatch

  if (isSupabaseConfigured()) {
    try {
      const remote = await getLogFromSupabase(id)
      if (remote) return remote
    } catch {
      // fall through
    }
  }

  if (authenticated && !isSupabaseConfigured()) {
    try {
      return await fetchLogContent(id)
    } catch {
      // fall through
    }
  }

  return localMatch ?? null
}

export function downloadSessionLog(log: SessionLogRecord): void {
  const blob = new Blob([log.content], { type: 'text/plain;charset=utf-8' })
  saveAs(blob, log.filename)
}

export async function downloadSessionLogById(
  id: string,
  filename: string,
  authenticated: boolean,
): Promise<void> {
  if (authenticated) {
    try {
      const response = await fetch(getLogDownloadUrl(id), { credentials: 'include' })
      if (!response.ok) throw new ApiError('Download failed', response.status)
      const blob = await response.blob()
      saveAs(blob, filename)
      return
    } catch {
      // fall through to local copy
    }
  }

  const log = await getSessionLog(id, authenticated)
  if (log) downloadSessionLog(log)
}

/** Save to Supabase/server/local store without triggering a download. */
export async function persistSessionLog(
  log: SessionLogRecord,
  authenticated: boolean,
): Promise<LogPersistTarget> {
  try {
    return await saveSessionLog(log, authenticated)
  } catch (err) {
    console.error('[BBExtract] Failed to persist session log:', err)
    try {
      await saveSessionLogLocal(log)
      return 'local'
    } catch (localErr) {
      console.error('[BBExtract] Failed to save log locally:', localErr)
      throw localErr
    }
  }
}
