export interface EnvSettings {
  supabaseUrl: string
  supabaseAnonKey: string
  storageBucket: string
}

export const DEFAULT_ENV_SETTINGS: EnvSettings = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL?.trim() ?? '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '',
  storageBucket: import.meta.env.VITE_SUPABASE_STORAGE_BUCKET?.trim() || 'bbextract',
}

export function loadEnvSettings(): EnvSettings {
  return { ...DEFAULT_ENV_SETTINGS }
}

export function isSupabaseConfigured(settings: EnvSettings = loadEnvSettings()): boolean {
  return Boolean(settings.supabaseUrl && settings.supabaseAnonKey)
}
