import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MouseEvent } from 'react'
import {
  downloadStoredExtractedFile,
  downloadStoredFolderZip,
  getStoredFilePreviewUrl,
  listStoredExtractedFiles,
  readStoredTextFile,
  renameStoredFile,
  renameStoredFolder,
  saveStoredTextFile,
  type StoredExtractedFile,
} from '../../lib/supabaseStorageStore'
import { formatBytes } from '../../lib/stats'
import { Button } from '../ui/Button'

interface FolderEntry {
  type: 'folder'
  name: string
  rawName: string
  path: string
  fileCount: number
  sizeBytes: number
  createdAt: string
  previewFile?: StoredExtractedFile
}

interface FileEntry {
  type: 'file'
  file: StoredExtractedFile
}

type FileManagerEntry = FolderEntry | FileEntry

interface ContextMenuState {
  x: number
  y: number
  entry: FileManagerEntry
}

interface EditorState {
  file: StoredExtractedFile
  content: string
  saving: boolean
}

function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/')
}

function parentPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function prettyName(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function isRunFolderName(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value) || /^\d{4}-\d{2}-\d{2}_/.test(value)
}

function formatFolderName(rawName: string, currentPath: string, file: StoredExtractedFile): string {
  const depth = currentPath ? currentPath.split('/').filter(Boolean).length : 0
  if (depth === 0 && isRunFolderName(rawName)) return `Run ${formatDateTime(file.createdAt)}`
  if (depth === 1) return file.modelName || prettyName(rawName)
  if (rawName === 'model_zip') return 'Model ZIP'
  if (rawName === 'raw_model') return 'Raw Model'
  if (rawName === 'json') return 'JSON'
  return prettyName(rawName)
}

function isEditable(file: StoredExtractedFile): boolean {
  const name = file.filename.toLowerCase()
  const mime = file.mimeType?.toLowerCase() ?? ''
  return mime.startsWith('text/') || mime.includes('json') || /\.(json|txt|mcmeta|bbmodel|geo)$/.test(name)
}

function entryMatchesSearch(entry: FileManagerEntry, searchQuery: string): boolean {
  if (!searchQuery.trim()) return true
  const query = searchQuery.toLowerCase()
  if (entry.type === 'folder') {
    return entry.name.toLowerCase().includes(query) || entry.path.toLowerCase().includes(query)
  }
  return [
    entry.file.filename,
    entry.file.fileKind,
    entry.file.modelName,
    entry.file.storagePath,
  ].some((value) => value.toLowerCase().includes(query))
}

function buildEntries(files: StoredExtractedFile[], currentPath: string): FileManagerEntry[] {
  const prefix = currentPath ? `${currentPath}/` : ''
  const folders = new Map<string, FolderEntry>()
  const directFiles: FileEntry[] = []

  for (const file of files) {
    if (!file.storagePath.startsWith(prefix)) continue

    const remainder = file.storagePath.slice(prefix.length)
    if (!remainder) continue

    const [firstPart, ...rest] = remainder.split('/')
    if (rest.length === 0) {
      directFiles.push({ type: 'file', file })
      continue
    }

    const folderPath = joinPath(currentPath, firstPart)
    const existing = folders.get(folderPath)
    if (existing) {
      existing.fileCount += 1
      existing.sizeBytes += file.sizeBytes ?? 0
      if (file.createdAt.localeCompare(existing.createdAt) > 0) {
        existing.createdAt = file.createdAt
        if (currentPath ? currentPath.split('/').filter(Boolean).length === 0 : true) {
          existing.name = formatFolderName(firstPart, currentPath, file)
        }
      }
      if (!existing.previewFile && file.fileKind === 'texture') {
        existing.previewFile = file
      }
    } else {
      folders.set(folderPath, {
        type: 'folder',
        name: formatFolderName(firstPart, currentPath, file),
        rawName: firstPart,
        path: folderPath,
        fileCount: 1,
        sizeBytes: file.sizeBytes ?? 0,
        createdAt: file.createdAt,
        previewFile: file.fileKind === 'texture' ? file : undefined,
      })
    }
  }

  return [
    ...[...folders.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ...directFiles.sort((a, b) => a.file.filename.localeCompare(b.file.filename)),
  ]
}

export function FileManagerView() {
  const [files, setFiles] = useState<StoredExtractedFile[]>([])
  const [currentPath, setCurrentPath] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    if (files.length === 0) setLoading(true)
    setError(null)
    try {
      setFiles(await listStoredExtractedFiles())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files')
    } finally {
      setLoading(false)
    }
  }, [files.length])

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

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('bbextract:storage-updated', onStorageUpdated)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [refresh])

  useEffect(() => {
    const closeMenu = () => setContextMenu(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('click', closeMenu)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => {
    if (!currentPath) return
    const hasFilesInPath = files.some((file) => file.storagePath.startsWith(`${currentPath}/`))
    if (!hasFilesInPath) setCurrentPath(parentPath(currentPath))
  }, [currentPath, files])

  const entries = useMemo(
    () => buildEntries(files, currentPath).filter((entry) => entryMatchesSearch(entry, searchQuery)),
    [currentPath, files, searchQuery],
  )

  const breadcrumbs = useMemo(() => {
    const parts = currentPath.split('/').filter(Boolean)
    return parts.map((part, index) => {
      const path = parts.slice(0, index + 1).join('/')
      const sampleFile = files.find((file) => file.storagePath.startsWith(`${path}/`))
      return {
        name: sampleFile ? formatFolderName(part, parts.slice(0, index).join('/'), sampleFile) : prettyName(part),
        path,
      }
    })
  }, [currentPath, files])

  useEffect(() => {
    const previewFiles = entries
      .map((entry) => (entry.type === 'folder' ? entry.previewFile : entry.file.fileKind === 'texture' ? entry.file : null))
      .filter((file): file is StoredExtractedFile => Boolean(file))
      .filter((file) => !previewUrls[file.storagePath])
      .slice(0, 24)

    if (previewFiles.length === 0) return

    let cancelled = false
    void Promise.all(
      previewFiles.map(async (file) => [file.storagePath, await getStoredFilePreviewUrl(file)] as const),
    ).then((results) => {
      if (cancelled) return
      setPreviewUrls((current) => {
        const next = { ...current }
        for (const [path, url] of results) {
          if (url) next[path] = url
        }
        return next
      })
    })

    return () => {
      cancelled = true
    }
  }, [entries, previewUrls])

  const runAction = useCallback(
    async (action: () => Promise<void>) => {
      setContextMenu(null)
      setError(null)
      try {
        await action()
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action failed')
      }
    },
    [refresh],
  )

  const openEditor = useCallback(
    async (file: StoredExtractedFile) => {
      setContextMenu(null)
      setError(null)
      try {
        const content = await readStoredTextFile(file)
        setEditor({ file, content, saving: false })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to open file')
      }
    },
    [],
  )

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="mb-1 text-2xl font-semibold text-text-primary max-sm:text-xl">Files</h1>
          <p className="text-base text-text-secondary max-sm:text-sm">
            Library view for folders, extracted files, and downloads.
          </p>
        </div>
        <Button variant="secondary" disabled={loading} className="max-sm:w-full" onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>

      <div className="rounded border border-border bg-surface-elevated/30 p-3 sm:p-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <Button variant="ghost" size="sm" disabled={!currentPath} onClick={() => setCurrentPath('')}>
            Root
          </Button>
          {breadcrumbs.map((crumb) => (
            <button
              key={crumb.path}
              type="button"
              onClick={() => setCurrentPath(crumb.path)}
              className="shrink-0 rounded border border-border px-2 py-1 font-mono text-xs text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text-primary"
            >
              / {crumb.name}
            </button>
          ))}
        </div>

        <label htmlFor="files-search" className="sr-only">
          Search files
        </label>
        <input
          id="files-search"
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search files and folders…"
          className="mt-3 w-full rounded border border-border bg-surface-base px-4 py-3 text-base text-text-primary placeholder:text-text-secondary/60 outline-none transition-colors focus:border-accent/60 focus:ring-1 focus:ring-accent/30 sm:mt-4 sm:text-sm"
        />
      </div>

      {error ? (
        <div className="rounded border border-red-500/40 bg-surface-elevated p-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <div className="min-h-[360px] rounded border border-border bg-surface-elevated/20 p-3 sm:min-h-[420px] sm:p-4">
        {loading ? (
          <p className="font-mono text-xs text-text-secondary">Loading files…</p>
        ) : entries.length === 0 ? (
          <div className="flex min-h-[260px] items-center justify-center rounded border border-dashed border-border bg-surface-base/40 sm:min-h-[320px]">
            <p className="text-sm text-text-secondary">No files found.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {entries.map((entry) => (
              <FileTile
                key={entry.type === 'folder' ? entry.path : entry.file.storagePath}
                entry={entry}
                previewUrl={
                  entry.type === 'folder'
                    ? entry.previewFile
                      ? previewUrls[entry.previewFile.storagePath]
                      : undefined
                    : previewUrls[entry.file.storagePath]
                }
                onOpen={() => {
                  if (entry.type === 'folder') {
                    setCurrentPath(entry.path)
                  } else if (isEditable(entry.file)) {
                    void openEditor(entry.file)
                  } else {
                    void runAction(() => downloadStoredExtractedFile(entry.file))
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setContextMenu({ x: event.clientX, y: event.clientY, entry })
                }}
              />
            ))}
          </div>
        )}
      </div>

      {contextMenu ? (
        <ContextMenu
          state={contextMenu}
          files={files}
          onOpenFolder={(path) => setCurrentPath(path)}
          onEditFile={(file) => void openEditor(file)}
          onDownloadFile={(file) => void runAction(() => downloadStoredExtractedFile(file))}
          onDownloadFolder={(path) => void runAction(() => downloadStoredFolderZip(path, files))}
          onRenameFile={(file) => {
            const nextName = window.prompt('Rename file', file.filename)
            if (nextName) void runAction(() => renameStoredFile(file, nextName))
          }}
          onRenameFolder={(folder) => {
            const nextName = window.prompt('Rename folder', folder.rawName)
            if (nextName) void runAction(() => renameStoredFolder(folder.path, nextName, files))
          }}
        />
      ) : null}

      {editor ? (
        <FileEditor
          editor={editor}
          onChange={(content) => setEditor((current) => (current ? { ...current, content } : current))}
          onClose={() => setEditor(null)}
          onSave={() => {
            setEditor((current) => (current ? { ...current, saving: true } : current))
            void runAction(async () => {
              await saveStoredTextFile(editor.file, editor.content)
              setEditor(null)
            })
          }}
        />
      ) : null}
    </div>
  )
}

function FileTile({
  entry,
  previewUrl,
  onOpen,
  onContextMenu,
}: {
  entry: FileManagerEntry
  previewUrl?: string
  onOpen: () => void
  onContextMenu: (event: MouseEvent) => void
}) {
  const isFolder = entry.type === 'folder'
  const title = isFolder ? entry.name : entry.file.filename
  const meta = isFolder
    ? `${entry.fileCount} file${entry.fileCount === 1 ? '' : 's'} · ${formatBytes(entry.sizeBytes)}`
    : `${entry.file.fileKind} · ${entry.file.sizeBytes ? formatBytes(entry.file.sizeBytes) : '—'}`

  return (
    <button
      type="button"
      onDoubleClick={onOpen}
      onClick={isFolder ? onOpen : undefined}
      onContextMenu={onContextMenu}
      className="group flex min-h-[104px] flex-col items-start justify-between rounded border border-border bg-surface-base/70 p-3 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-accent/40 hover:bg-surface-elevated hover:shadow-lg hover:shadow-black/10 sm:min-h-[118px] sm:p-4"
    >
      <div className="flex w-full items-start gap-3">
        <TileIcon isFolder={isFolder} previewUrl={previewUrl} />
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-text-primary">{title}</h3>
          <p className="mt-1 font-mono text-xs text-text-secondary">{meta}</p>
          {isFolder && entry.rawName !== entry.name ? (
            <p className="mt-1 truncate font-mono text-[10px] text-text-secondary/60">{entry.rawName}</p>
          ) : null}
        </div>
      </div>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary/70 sm:mt-4">
        Right click for actions
      </p>
    </button>
  )
}

function TileIcon({ isFolder, previewUrl }: { isFolder: boolean; previewUrl?: string }) {
  if (previewUrl) {
    return (
      <div className="h-11 w-11 shrink-0 overflow-hidden rounded border border-border bg-surface-elevated sm:h-12 sm:w-12">
        <img src={previewUrl} alt="" className="h-full w-full object-cover [image-rendering:pixelated]" />
      </div>
    )
  }

  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded border border-border bg-surface-elevated sm:h-12 sm:w-12">
      {isFolder ? (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M3 7h6l2 2h10v9H3z"
            fill="rgb(234 179 8 / 0.18)"
            stroke="rgb(234 179 8)"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M3 7V5h6l2 2" stroke="rgb(234 179 8)" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M6 3h8l4 4v14H6z"
            stroke="var(--text-secondary)"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M14 3v5h4" stroke="var(--text-secondary)" strokeWidth="1.4" />
        </svg>
      )}
    </div>
  )
}

function ContextMenu({
  state,
  files,
  onOpenFolder,
  onEditFile,
  onDownloadFile,
  onDownloadFolder,
  onRenameFile,
  onRenameFolder,
}: {
  state: ContextMenuState
  files: StoredExtractedFile[]
  onOpenFolder: (path: string) => void
  onEditFile: (file: StoredExtractedFile) => void
  onDownloadFile: (file: StoredExtractedFile) => void
  onDownloadFolder: (path: string) => void
  onRenameFile: (file: StoredExtractedFile) => void
  onRenameFolder: (folder: FolderEntry) => void
}) {
  let menuItems
  if (state.entry.type === 'folder') {
    const folder = state.entry
    menuItems = (
      <FolderMenuItems
        folder={folder}
        hasFiles={files.some((file) => file.storagePath.startsWith(`${folder.path}/`))}
        onOpenFolder={onOpenFolder}
        onDownloadFolder={onDownloadFolder}
        onRenameFolder={onRenameFolder}
      />
    )
  } else {
    const file = state.entry.file
    menuItems = (
      <FileMenuItems
        file={file}
        onEditFile={onEditFile}
        onDownloadFile={onDownloadFile}
        onRenameFile={onRenameFile}
      />
    )
  }

  return (
    <div
      className="fixed z-50 min-w-48 overflow-hidden rounded border border-border bg-surface-elevated py-1 shadow-2xl shadow-black/30 max-sm:!left-3 max-sm:!top-auto max-sm:right-3 max-sm:bottom-24"
      style={{ left: state.x, top: state.y }}
      onClick={(event) => event.stopPropagation()}
    >
      {menuItems}
    </div>
  )
}

function FolderMenuItems({
  folder,
  hasFiles,
  onOpenFolder,
  onDownloadFolder,
  onRenameFolder,
}: {
  folder: FolderEntry
  hasFiles: boolean
  onOpenFolder: (path: string) => void
  onDownloadFolder: (path: string) => void
  onRenameFolder: (folder: FolderEntry) => void
}) {
  return (
    <>
      <MenuItem onClick={() => onOpenFolder(folder.path)}>Open</MenuItem>
      <MenuItem onClick={() => onRenameFolder(folder)}>Rename</MenuItem>
      <MenuItem disabled={!hasFiles} onClick={() => onDownloadFolder(folder.path)}>
        Download ZIP
      </MenuItem>
    </>
  )
}

function FileMenuItems({
  file,
  onEditFile,
  onDownloadFile,
  onRenameFile,
}: {
  file: StoredExtractedFile
  onEditFile: (file: StoredExtractedFile) => void
  onDownloadFile: (file: StoredExtractedFile) => void
  onRenameFile: (file: StoredExtractedFile) => void
}) {
  return (
    <>
      <MenuItem onClick={() => onDownloadFile(file)}>Download</MenuItem>
      <MenuItem onClick={() => onRenameFile(file)}>Rename</MenuItem>
      <MenuItem disabled={!isEditable(file)} onClick={() => onEditFile(file)}>
        Edit
      </MenuItem>
    </>
  )
}

function MenuItem({
  children,
  onClick,
  disabled = false,
}: {
  children: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="block w-full px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-surface-base hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function FileEditor({
  editor,
  onChange,
  onClose,
  onSave,
}: {
  editor: EditorState
  onChange: (content: string) => void
  onClose: () => void
  onSave: () => void
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-3 py-4 sm:px-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded border border-border bg-surface-elevated shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-text-primary">{editor.file.filename}</h2>
            <p className="truncate font-mono text-xs text-text-secondary">{editor.file.storagePath}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <textarea
          value={editor.content}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          className="min-h-[320px] flex-1 resize-none border-0 bg-surface-base p-3 font-mono text-xs text-text-primary outline-none sm:min-h-[420px] sm:p-4"
        />
        <div className="flex justify-end gap-2 border-t border-border px-3 py-3 sm:px-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={editor.saving} onClick={onSave}>
            {editor.saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}
