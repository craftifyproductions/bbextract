/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_SUPABASE_STORAGE_BUCKET?: string
  readonly VITE_STORAGE_QUOTA_GB?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
