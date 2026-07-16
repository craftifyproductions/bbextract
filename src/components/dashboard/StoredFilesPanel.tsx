import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  downloadStoredExtractedFile,
  listStoredExtractedFiles,
  type StoredExtractedFile,
} from '../../lib/supabaseStorageStore'
import { getSupabaseClient } from '../../lib/supabaseClient'
import { formatBytes } from '../../lib/stats'
import { Button } from '../ui/Button'

interface StoredFilesPanelProps {
  searchQuery: string
}

function matchesSearch(file: StoredExtractedFile, searchQuery: string): boolean {
  if (!searchQuery.trim()) return true
  const query = searchQuery.toLowerCase()
  return [
    file.modelName,
    file.filename,
    file.fileKind,
    file.userEmail ?? '',
    file.storagePath,
  ].some((value) => value.toLowerCase().includes(query))
}

function groupByModel(files: StoredExtractedFile[]): Array<[string, StoredExtractedFile[]]> {
  const groups = new Map<string, StoredExtractedFile[]>()
  for (const file of files) {
    const key = file.modelName || 'Unknown model'
    groups.set(key, [...(groups.get(key) ?? []), file])
  }
  return [...groups.entries()]
}

export function StoredFilesPanel({ searchQuery }: StoredFilesPanelProps) {
  const [files, setFiles] = useState<StoredExtractedFile[]>([])
  const [expandedModel, setExpandedModel] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setFiles(await listStoredExtractedFiles())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stored files')
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
        .channel('bbextract-dashboard-files')
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

  const groupedFiles = useMemo(
    () => groupByModel(files.filter((file) => matchesSearch(file, searchQuery))),
    [files, searchQuery],
  )

  if (loading) {
    return <p className="font-mono text-xs text-text-secondary">Loading saved files…</p>
  }

  if (error) {
    return (
      <div className="rounded border border-red-500/40 bg-surface-elevated p-4">
        <p className="text-sm text-red-300">Failed to load saved files: {error}</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => void refresh()}>
          Retry
        </Button>
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className="rounded border border-border bg-surface-base/60 p-3">
        <p className="text-sm text-text-secondary">
          No saved files yet. Upload a model and extracted files will appear here.
        </p>
      </div>
    )
  }

  if (groupedFiles.length === 0) {
    return (
      <div className="rounded border border-border bg-surface-base/60 p-3">
        <p className="text-sm text-text-secondary">No stored files match your search.</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded border border-border bg-surface-base/60">
      {groupedFiles.map(([modelName, modelFiles]) => (
        <section key={modelName} className="border-b border-border last:border-b-0">
          <button
            type="button"
            onClick={() => setExpandedModel((current) => (current === modelName ? null : modelName))}
            className="flex w-full flex-wrap items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-elevated/60"
          >
            <div className="min-w-[220px] flex-1">
              <h3 className="truncate text-sm font-medium text-text-primary">{modelName}</h3>
              <p className="font-mono text-xs text-text-secondary">
                {modelFiles.length} stored file{modelFiles.length === 1 ? '' : 's'}
              </p>
            </div>
            <TypeCounts files={modelFiles} />
            <span className="font-mono text-xs text-text-secondary">
              {expandedModel === modelName ? 'Collapse' : 'Expand'}
            </span>
          </button>
          {expandedModel === modelName ? (
            <div className="divide-y divide-border border-t border-border bg-surface-base/70">
              {modelFiles.map((file) => (
                <StoredFileRow key={file.id} file={file} />
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  )
}

function TypeCounts({ files }: { files: StoredExtractedFile[] }) {
  const counts = files.reduce<Record<string, number>>((acc, file) => {
    acc[file.fileKind] = (acc[file.fileKind] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="flex flex-wrap gap-1">
      {Object.entries(counts).map(([kind, count]) => (
        <span
          key={kind}
          className="rounded border border-border bg-surface-elevated px-2 py-1 font-mono text-xs text-text-secondary"
        >
          {kind}: <span className="text-text-primary">{count}</span>
        </span>
      ))}
    </div>
  )
}

function StoredFileRow({ file }: { file: StoredExtractedFile }) {
  const [downloading, setDownloading] = useState(false)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate font-mono text-xs text-text-primary">{file.filename}</p>
        <p className="mt-1 font-mono text-xs text-text-secondary">
          {file.fileKind} · {file.sizeBytes ? formatBytes(file.sizeBytes) : '—'} ·{' '}
          {new Date(file.createdAt).toLocaleString()}
        </p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        disabled={downloading}
        onClick={async () => {
          setDownloading(true)
          try {
            await downloadStoredExtractedFile(file)
          } finally {
            setDownloading(false)
          }
        }}
      >
        {downloading ? 'Downloading…' : 'Download'}
      </Button>
    </div>
  )
}
