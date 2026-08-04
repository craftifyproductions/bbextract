import { fetchWithRetry } from './fetchWithRetry'

const API_BASE = ''

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // ignore
    }
    throw new ApiError(message, response.status)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

async function getSupabaseBearerToken(): Promise<string | null> {
  try {
    const { getSupabaseClient } = await import('./supabaseClient')
    const supabase = await getSupabaseClient()
    const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } }
    return data.session?.access_token ?? null
  } catch {
    return null
  }
}

async function binaryRequest(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getSupabaseBearerToken()
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetchWithRetry(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  })

  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // ignore
    }
    throw new ApiError(message, response.status)
  }

  return response
}

export interface SessionResponse {
  authenticated: boolean
}

export function checkSession(): Promise<SessionResponse> {
  return request<SessionResponse>('/api/auth/session')
}

export function login(password: string): Promise<{ ok: boolean }> {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
}

export function logout(): Promise<{ ok: boolean }> {
  return request('/api/auth/logout', { method: 'POST' })
}

export interface LogMetaResponse {
  id: string
  filename: string
  createdAt: string
  userEmail?: string
  fileCount: number
  successCount: number
  errorCount: number
}

export interface LogRecordResponse extends LogMetaResponse {
  content: string
}

export function fetchLogs(): Promise<LogMetaResponse[]> {
  return request('/api/logs')
}

export function saveLog(log: LogRecordResponse): Promise<{ ok: boolean }> {
  return request('/api/logs', {
    method: 'POST',
    body: JSON.stringify(log),
  })
}

export function fetchLogContent(id: string): Promise<LogRecordResponse> {
  return request(`/api/logs/${id}`)
}

export function getLogDownloadUrl(id: string): string {
  return `/api/logs/${id}/download`
}

export interface R2UploadResponse {
  ok: boolean
  bucket: string
  storagePath: string
  sizeBytes: number
  contentType: string
}

export interface R2HealthResponse {
  ok: boolean
  configured: boolean
  bucket?: string
  prefix?: string
  maxUploadBytes?: number
}

export async function checkR2Health(): Promise<R2HealthResponse> {
  const response = await binaryRequest('/api/r2/health')
  return response.json() as Promise<R2HealthResponse>
}

export interface R2ListResponse {
  ok: boolean
  count: number
  bucket?: string
  files: Array<{
    storagePath: string
    sizeBytes: number
    lastModified: string | null
  }>
}

export async function listR2Files(limit = 20_000, prefix = ''): Promise<R2ListResponse> {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  if (prefix) params.set('prefix', prefix)
  const response = await binaryRequest(`/api/r2/list?${params.toString()}`)
  return response.json() as Promise<R2ListResponse>
}

export async function uploadR2File(
  storagePath: string,
  blob: Blob,
  contentType = blob.type || 'application/octet-stream',
): Promise<R2UploadResponse> {
  const response = await binaryRequest('/api/r2/file', {
    method: 'PUT',
    body: blob,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-BBExtract-Path': storagePath,
      'X-BBExtract-Content-Type': contentType,
    },
  })

  return response.json() as Promise<R2UploadResponse>
}

export async function downloadR2File(storagePath: string): Promise<Blob> {
  const response = await binaryRequest(`/api/r2/file?path=${encodeURIComponent(storagePath)}`)
  return response.blob()
}

export interface R2DeleteResponse {
  ok: boolean
  storagePath?: string
  prefix?: string
  deletedCount?: number
}

export async function deleteR2File(storagePath: string): Promise<R2DeleteResponse> {
  const response = await binaryRequest(`/api/r2/file?path=${encodeURIComponent(storagePath)}`, {
    method: 'DELETE',
  })
  return response.json() as Promise<R2DeleteResponse>
}

export async function deleteR2Prefix(prefix: string): Promise<R2DeleteResponse> {
  const response = await binaryRequest(`/api/r2/prefix?prefix=${encodeURIComponent(prefix)}`, {
    method: 'DELETE',
  })
  return response.json() as Promise<R2DeleteResponse>
}
