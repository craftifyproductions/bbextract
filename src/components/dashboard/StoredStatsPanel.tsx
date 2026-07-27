import { useCallback, useEffect, useMemo, useState } from 'react'
import { getStorageUsage, type StorageUsage } from '../../lib/supabaseStorageStore'
import { getSupabaseClient } from '../../lib/supabaseClient'
import { formatBytes } from '../../lib/stats'
import { Button } from '../ui/Button'

const EMPTY_STORAGE_USAGE: StorageUsage = {
  usedBytes: 0,
  fileCount: 0,
  modelCount: 0,
  textureCount: 0,
  animationCount: 0,
  elementCount: 0,
  boneCount: 0,
  jsonCount: 0,
  geometryCount: 0,
  metadataCount: 0,
  summaryCount: 0,
  rawModelCount: 0,
}

const SAVED_LIBRARY_CATEGORIES: Array<{
  key: keyof StorageUsage
  label: string
  hoverClass: string
}> = [
  {
    key: 'modelCount',
    label: 'Saved Models',
    hoverClass: 'hover:bg-blue-500/12 hover:border-blue-400/35',
  },
  {
    key: 'elementCount',
    label: 'Elements',
    hoverClass: 'hover:bg-emerald-500/12 hover:border-emerald-400/35',
  },
  {
    key: 'boneCount',
    label: 'Bones',
    hoverClass: 'hover:bg-orange-500/12 hover:border-orange-400/35',
  },
  {
    key: 'textureCount',
    label: 'Textures',
    hoverClass: 'hover:bg-violet-500/12 hover:border-violet-400/35',
  },
  {
    key: 'animationCount',
    label: 'Animations',
    hoverClass: 'hover:bg-pink-500/12 hover:border-pink-400/35',
  },
  {
    key: 'jsonCount',
    label: 'JSON',
    hoverClass: 'hover:bg-cyan-500/12 hover:border-cyan-400/35',
  },
  {
    key: 'geometryCount',
    label: 'Geometry',
    hoverClass: 'hover:bg-teal-500/12 hover:border-teal-400/35',
  },
  {
    key: 'metadataCount',
    label: 'Metadata',
    hoverClass: 'hover:bg-indigo-500/12 hover:border-indigo-400/35',
  },
  {
    key: 'summaryCount',
    label: 'Summary',
    hoverClass: 'hover:bg-yellow-500/12 hover:border-yellow-400/35',
  },
  {
    key: 'rawModelCount',
    label: 'Raw Models',
    hoverClass: 'hover:bg-rose-500/12 hover:border-rose-400/35',
  },
  {
    key: 'fileCount',
    label: 'Files',
    hoverClass: 'hover:bg-slate-400/12 hover:border-slate-300/35',
  },
]

const STORED_BYTES_HOVER_CLASS = 'hover:bg-amber-500/12 hover:border-amber-400/35'

export function StoredStatsPanel() {
  const [storageUsage, setStorageUsage] = useState<StorageUsage>(EMPTY_STORAGE_USAGE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const usage = await getStorageUsage()
      setStorageUsage(usage)
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

  const storedBytesLabel = useMemo(() => {
    if (loading) return '…'
    return storageUsage.usedBytes ? formatBytes(storageUsage.usedBytes) : '0 B'
  }, [loading, storageUsage.usedBytes])

  return (
    <section className="rounded border border-border bg-surface-elevated/30 p-3 sm:p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 max-sm:items-start">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Saved Library</h2>
          <p className="mt-1 text-xs text-text-secondary">
            Database totals for all persisted models and files.
          </p>
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {SAVED_LIBRARY_CATEGORIES.map(({ key, label, hoverClass }) => (
            <StatCard
              key={key}
              label={label}
              value={loading ? '…' : storageUsage[key].toLocaleString()}
              hoverClass={hoverClass}
            />
          ))}
          <StatCard
            label="Stored"
            value={storedBytesLabel}
            hint="Total from database"
            hoverClass={STORED_BYTES_HOVER_CLASS}
          />
        </div>
      )}
    </section>
  )
}

function StatCard({
  label,
  value,
  hint,
  hoverClass,
}: {
  label: string
  value: number | string
  hint?: string
  hoverClass?: string
}) {
  return (
    <div
      className={`rounded border border-border bg-surface-base/70 p-3 transition-colors duration-200 sm:p-4 ${hoverClass ?? ''}`}
    >
      <p className="text-[10px] uppercase tracking-[0.16em] text-text-secondary sm:text-xs sm:tracking-[0.18em]">{label}</p>
      <p className="mt-2 break-words font-mono text-2xl font-semibold text-text-primary sm:text-3xl">{value}</p>
      {hint ? <p className="mt-1 text-[10px] text-text-secondary">{hint}</p> : null}
    </div>
  )
}
