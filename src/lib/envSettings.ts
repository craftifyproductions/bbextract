export interface EnvSettings {
  supabaseUrl: string
  supabaseAnonKey: string
  storageBucket: string
  /** Total storage quota in bytes (from VITE_STORAGE_QUOTA_GB). */
  storageQuotaBytes: number
}

const DEFAULT_STORAGE_QUOTA_GB = 10

function parseStorageQuotaBytes(): number {
  const raw = import.meta.env.VITE_STORAGE_QUOTA_GB?.trim()
  const gb = raw ? Number(raw) : DEFAULT_STORAGE_QUOTA_GB
  if (!Number.isFinite(gb) || gb <= 0) return DEFAULT_STORAGE_QUOTA_GB * 1024 * 1024 * 1024
  return gb * 1024 * 1024 * 1024
}

export const DEFAULT_ENV_SETTINGS: EnvSettings = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL?.trim() ?? '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '',
  storageBucket: import.meta.env.VITE_SUPABASE_STORAGE_BUCKET?.trim() || 'bbextract',
  storageQuotaBytes: parseStorageQuotaBytes(),
}

export function loadEnvSettings(): EnvSettings {
  return { ...DEFAULT_ENV_SETTINGS }
}

export function isSupabaseConfigured(settings: EnvSettings = loadEnvSettings()): boolean {
  return Boolean(settings.supabaseUrl && settings.supabaseAnonKey)
}
