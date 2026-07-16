import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  downloadStoredModelZip,
  listStoredExtractedModels,
  type StoredExtractedModel,
} from '../../lib/supabaseStorageStore'
import { getSupabaseClient } from '../../lib/supabaseClient'
import { formatBytes } from '../../lib/stats'
import { Button } from '../ui/Button'

interface StoredModelsPanelProps {
  searchQuery: string
}

function matchesSearch(model: StoredExtractedModel, searchQuery: string): boolean {
  if (!searchQuery.trim()) return true
  const query = searchQuery.toLowerCase()
  return [
    model.modelName,
    model.originalFilename,
    model.folderName ?? '',
    model.userEmail ?? '',
    model.fileHash,
  ].some((value) => value.toLowerCase().includes(query))
}

export function StoredModelsPanel({ searchQuery }: StoredModelsPanelProps) {
  const [models, setModels] = useState<StoredExtractedModel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setModels(await listStoredExtractedModels())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stored models')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()

    const onStorageUpdated = () => void refresh()
    const onFocus = () => void refresh()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const interval = window.setInterval(() => void refresh(), 10_000)

    window.addEventListener('bbextract:storage-updated', onStorageUpdated)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    let removeChannel: (() => void) | undefined
    void getSupabaseClient().then((supabase) => {
      if (!supabase) return
      const channel = supabase
        .channel('bbextract-dashboard-models')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'extracted_models' },
          () => void refresh(),
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'storage', table: 'objects' },
          () => void refresh(),
        )
        .subscribe()
      removeChannel = () => {
        void supabase.removeChannel(channel)
      }
    })

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('bbextract:storage-updated', onStorageUpdated)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      removeChannel?.()
    }
  }, [refresh])

  const filteredModels = useMemo(
    () => models.filter((model) => matchesSearch(model, searchQuery)),
    [models, searchQuery],
  )

  if (loading) {
    return <p className="font-mono text-xs text-text-secondary">Loading saved models…</p>
  }

  if (error) {
    return (
      <div className="rounded border border-red-500/40 bg-surface-elevated p-4">
        <p className="text-sm text-red-300">Failed to load saved models: {error}</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => void refresh()}>
          Retry
        </Button>
      </div>
    )
  }

  if (models.length === 0) {
    return (
      <div className="rounded border border-border bg-surface-base/60 p-3">
        <p className="text-sm text-text-secondary">
          No saved models yet. New successful uploads will appear here after extraction.
        </p>
      </div>
    )
  }

  if (filteredModels.length === 0) {
    return (
      <div className="rounded border border-border bg-surface-base/60 p-3">
        <p className="text-sm text-text-secondary">No saved models match your search.</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded border border-border bg-surface-base/60">
      {filteredModels.map((model) => (
        <StoredModelCard key={model.id} model={model} />
      ))}
    </div>
  )
}

function StoredModelCard({ model }: { model: StoredExtractedModel }) {
  const [downloading, setDownloading] = useState(false)

  return (
    <article className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0">
      <div className="min-w-[220px] flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-medium text-text-primary">{model.modelName}</h3>
          <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
            {new Date(model.createdAt).toLocaleDateString()}
          </span>
        </div>
        <p className="mt-0.5 truncate font-mono text-xs text-text-secondary">{model.originalFilename}</p>
      </div>

      <dl className="flex flex-wrap gap-1 font-mono text-xs">
        <Stat label="Elements" value={model.elementCount ?? 0} />
        <Stat label="Bones" value={model.boneCount ?? 0} />
        <Stat label="Tex" value={model.textureCount ?? 0} />
        <Stat label="Anim" value={model.animationCount ?? 0} />
      </dl>

      <p className="font-mono text-xs text-text-secondary">
        {model.originalSizeBytes ? formatBytes(model.originalSizeBytes) : '—'}
        {model.extractedSizeBytes ? ` → ${formatBytes(model.extractedSizeBytes)}` : ''}
      </p>

      <Button
        variant="primary"
        size="sm"
        disabled={downloading || !model.modelZipPath}
        onClick={async () => {
          setDownloading(true)
          try {
            await downloadStoredModelZip(model)
          } finally {
            setDownloading(false)
          }
        }}
      >
        {downloading ? 'Downloading…' : model.modelZipPath ? 'Download ZIP' : 'ZIP unavailable'}
      </Button>
    </article>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex gap-1 rounded border border-border bg-surface-elevated px-2 py-1">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="text-text-primary">{value}</dd>
    </div>
  )
}
