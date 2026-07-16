import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  listStoredExtractedFiles,
  listStoredExtractedModels,
  type StoredExtractedFile,
  type StoredExtractedModel,
} from '../../lib/supabaseStorageStore'
import { getSupabaseClient } from '../../lib/supabaseClient'
import { formatBytes } from '../../lib/stats'
import type { ProcessedModel } from '../../lib/types'
import { StatsBar } from '../layout/StatsBar'
import { Button } from '../ui/Button'

interface StoredStatsPanelProps {
  models: ProcessedModel[]
}

interface SavedStats {
  modelCount: number
  textureCount: number
  animationCount: number
  fileCount: number
  totalBytes: number
}

function computeSavedStats(models: StoredExtractedModel[], files: StoredExtractedFile[]): SavedStats {
  return {
    modelCount: models.length,
    textureCount: files.filter((file) => file.fileKind === 'texture').length,
    animationCount: files.filter((file) => file.fileKind === 'animation').length,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0),
  }
}

export function StoredStatsPanel({ models }: StoredStatsPanelProps) {
  const [storedModels, setStoredModels] = useState<StoredExtractedModel[]>([])
  const [storedFiles, setStoredFiles] = useState<StoredExtractedFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextModels, nextFiles] = await Promise.all([
        listStoredExtractedModels(),
        listStoredExtractedFiles(),
      ])
      setStoredModels(nextModels)
      setStoredFiles(nextFiles)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats')
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
    void getSupabaseClient().then((client) => {
      if (!client) return
      const channel = client
        .channel('bbextract-dashboard-stats')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'extracted_models' },
          () => void refresh(),
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'extracted_files' },
          () => void refresh(),
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'storage', table: 'objects' },
          () => void refresh(),
        )
        .subscribe()
      removeChannel = () => {
        void client.removeChannel(channel)
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

  const savedStats = useMemo(
    () => computeSavedStats(storedModels, storedFiles),
    [storedModels, storedFiles],
  )

  return (
    <div className="space-y-4 sm:space-y-6">
      <section className="rounded border border-border bg-surface-elevated/30 p-3 sm:p-4">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-text-primary">Current Session</h2>
          <p className="mt-1 text-xs text-text-secondary">Local extraction stats for this browser tab.</p>
        </div>
        <StatsBar models={models} />
      </section>

      <section className="rounded border border-border bg-surface-elevated/30 p-3 sm:p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 max-sm:items-start">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Saved Library</h2>
            <p className="mt-1 text-xs text-text-secondary">Only totals and quick stats.</p>
          </div>
          <Button variant="secondary" size="sm" disabled={loading} className="max-sm:w-full" onClick={() => void refresh()}>
            Refresh
          </Button>
        </div>

        {error ? (
          <p className="rounded border border-red-500/40 bg-surface-base/60 p-3 text-sm text-red-300">
            Failed to load stats: {error}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
            <StatCard label="Saved Models" value={loading ? '…' : savedStats.modelCount} />
            <StatCard label="Textures" value={loading ? '…' : savedStats.textureCount} />
            <StatCard label="Animations" value={loading ? '…' : savedStats.animationCount} />
            <StatCard label="Files" value={loading ? '…' : savedStats.fileCount} />
            <StatCard
              label="Size"
              value={loading ? '…' : savedStats.totalBytes ? formatBytes(savedStats.totalBytes) : '0 B'}
            />
          </div>
        )}
      </section>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border border-border bg-surface-base/70 p-3 sm:p-4">
      <p className="text-[10px] uppercase tracking-[0.16em] text-text-secondary sm:text-xs sm:tracking-[0.18em]">{label}</p>
      <p className="mt-2 break-words font-mono text-2xl font-semibold text-text-primary sm:text-3xl">{value}</p>
    </div>
  )
}
