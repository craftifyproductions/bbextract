import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadEnvSettings } from '../../lib/envSettings'
import { getSupabaseClient } from '../../lib/supabaseClient'
import { getStorageUsage } from '../../lib/supabaseStorageStore'
import { formatStorageCompact } from '../../lib/stats'

interface StorageBarProps {
  authenticated?: boolean
}

function barColor(percentUsed: number): string {
  if (percentUsed >= 90) return 'bg-red-500'
  if (percentUsed >= 70) return 'bg-amber-500'
  return 'bg-accent'
}

export function StorageBar({ authenticated = false }: StorageBarProps) {
  const quotaBytes = loadEnvSettings().storageQuotaBytes
  const [usedBytes, setUsedBytes] = useState(0)
  const [fileCount, setFileCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const usage = await getStorageUsage()
      setUsedBytes(usage.usedBytes)
      setFileCount(usage.fileCount)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load storage')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!authenticated) return

    void refresh()

    const onStorageUpdated = () => void refresh()
    const onFocus = () => void refresh()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const interval = window.setInterval(() => void refresh(), 30_000)

    window.addEventListener('bbextract:storage-updated', onStorageUpdated)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    let removeChannel: (() => void) | undefined
    void getSupabaseClient().then((client) => {
      if (!client) return
      const channel = client
        .channel('bbextract-storage-bar')
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
  }, [authenticated, refresh])

  const { percentUsed, remainingBytes } = useMemo(() => {
    const percent = quotaBytes > 0 ? Math.min(100, (usedBytes / quotaBytes) * 100) : 0
    return {
      percentUsed: percent,
      remainingBytes: Math.max(0, quotaBytes - usedBytes),
    }
  }, [quotaBytes, usedBytes])

  if (!authenticated) return null

  return (
    <div className="border-t border-border px-4 py-4 max-md:hidden">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-text-secondary">
          Database storage
        </p>
        {loading ? (
          <p className="font-mono text-[10px] text-text-secondary">…</p>
        ) : error ? (
          <p className="text-[10px] text-red-400" title={error}>
            Unavailable
          </p>
        ) : (
          <p className="font-mono text-[10px] text-text-secondary">
            {formatStorageCompact(remainingBytes)} left
          </p>
        )}
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-base"
        role="progressbar"
        aria-valuenow={Math.round(percentUsed)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Storage used"
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${loading ? 'bg-border' : barColor(percentUsed)}`}
          style={{ width: loading ? '0%' : `${percentUsed}%` }}
        />
      </div>

      {!loading && !error ? (
        <p className="mt-2 font-mono text-[10px] text-text-secondary">
          {formatStorageCompact(usedBytes)} used of {formatStorageCompact(quotaBytes)}
          {fileCount > 0 ? ` · ${fileCount.toLocaleString()} file${fileCount === 1 ? '' : 's'}` : ''}
        </p>
      ) : null}
    </div>
  )
}
