import { useCallback, useRef, useState } from 'react'
import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js'
import type { DirectUploadAssetKind, UploadItem } from '../../lib/types'

interface DropZoneProps {
  onFiles: (files: UploadItem[]) => void
  onReject: (message: string) => void
  disabled?: boolean
  compact?: boolean
}

const MAX_DIRECT_FILES_PER_BATCH = 50
const MAX_DIRECT_FILE_SIZE_BYTES = 50 * 1024 * 1024
const ZIP_EMIT_CHUNK_SIZE = 10

function isBbmodelFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.bbmodel') && file.size <= MAX_DIRECT_FILE_SIZE_BYTES
}

function isZipFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.zip')
}

function fileExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function inferAssetKind(name: string): DirectUploadAssetKind | null {
  const ext = fileExtension(name)
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'texture'
  if (ext === 'json') return 'json'
  return null
}

function zipEntryFilename(zipName: string, entryName: string): string {
  const zipBase = zipName.replace(/\.zip$/i, '').replace(/[^\w.-]+/g, '_') || 'archive'
  const entryBase = entryName.split('/').pop() || 'file'
  const cleanEntry = entryBase.replace(/[^\w.-]+/g, '_')
  return `${zipBase}__${cleanEntry}`
}

function fileTypeForName(name: string): string {
  const ext = fileExtension(name)
  if (ext === 'json' || ext === 'bbmodel') return 'application/json'
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  return 'application/octet-stream'
}

function directUploadItem(file: File): UploadItem | null {
  if (isBbmodelFile(file)) return { kind: 'model', file }
  return null
}

function zipUploadItem(
  zipFile: File,
  entryName: string,
  blob: Blob,
  uploadBatchId: string,
): UploadItem | null {
  const lowerName = entryName.toLowerCase()
  const assetKind = inferAssetKind(entryName)
  const isModel = lowerName.endsWith('.bbmodel')
  if (!isModel && !assetKind) return null

  const file = new File([blob], zipEntryFilename(zipFile.name, entryName), {
    type: fileTypeForName(entryName),
  })

  if (isModel) {
    return {
      kind: 'model',
      file,
      sourceArchive: zipFile.name,
      originalPath: entryName,
      uploadBatchId,
    }
  }

  return {
    kind: 'asset',
    file,
    assetKind: assetKind!,
    sourceArchive: zipFile.name,
    originalPath: entryName,
    uploadBatchId,
  }
}

function markBatchComplete(items: UploadItem[]): UploadItem[] {
  if (items.length === 0) return items
  return items.map((item, index) =>
    index === items.length - 1 ? { ...item, uploadBatchComplete: true } : item,
  )
}

async function extractZipInChunks(
  file: File,
  emitItems: (items: UploadItem[]) => void,
): Promise<{ accepted: number; skipped: number }> {
  const reader = new ZipReader(new BlobReader(file))
  let accepted = 0
  let skipped = 0
  let chunk: UploadItem[] = []
  let pendingChunk: UploadItem[] | null = null
  const uploadBatchId = crypto.randomUUID()

  const flushPending = () => {
    if (!pendingChunk) return
    emitItems(pendingChunk)
    pendingChunk = null
  }

  try {
    const entries = await reader.getEntries()
    entries.sort((a, b) => a.filename.localeCompare(b.filename))

    for (const entry of entries) {
      if (entry.directory || !entry.getData) continue

      const type = fileTypeForName(entry.filename)
      const itemKind = entry.filename.toLowerCase().endsWith('.bbmodel')
        ? 'model'
        : inferAssetKind(entry.filename)
      if (!itemKind) {
        skipped += 1
        continue
      }

      const blob = await entry.getData(new BlobWriter(type))
      const item = zipUploadItem(file, entry.filename, blob, uploadBatchId)
      if (!item) {
        skipped += 1
        continue
      }

      chunk.push(item)
      accepted += 1

      if (chunk.length >= ZIP_EMIT_CHUNK_SIZE) {
        flushPending()
        pendingChunk = chunk
        chunk = []
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    }

    if (chunk.length > 0) {
      flushPending()
      pendingChunk = chunk
    }

    if (pendingChunk) {
      emitItems(markBatchComplete(pendingChunk))
      pendingChunk = null
    }
  } finally {
    await reader.close()
  }

  return { accepted, skipped }
}

export function DropZone({ onFiles, onReject, disabled = false, compact = false }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [expanding, setExpanding] = useState(false)

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const all = Array.from(fileList)
      const directFiles = all.filter((file) => !isZipFile(file))
      const zipFiles = all.filter(isZipFile)
      const unsupportedDirectFiles = directFiles.filter((file) => !directUploadItem(file))

      if (directFiles.length > MAX_DIRECT_FILES_PER_BATCH) {
        onReject(`Maximum ${MAX_DIRECT_FILES_PER_BATCH} direct .bbmodel files per batch`)
        return
      }

      setExpanding(true)
      let accepted = 0
      let skipped = unsupportedDirectFiles.length

      try {
        const directItems = directFiles
          .map(directUploadItem)
          .filter((item): item is UploadItem => Boolean(item))
        if (directItems.length > 0) {
          accepted += directItems.length
          onFiles(directItems)
        }

        for (const file of zipFiles) {
          const result = await extractZipInChunks(file, (items) => {
            accepted += items.length
            onFiles(items)
          })
          skipped += result.skipped
          if (result.accepted === 0) skipped += 1
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to read ZIP file'
        onReject(`Could not extract ZIP - ${message}`)
        setExpanding(false)
        return
      }

      setExpanding(false)

      if (accepted === 0) {
        onReject('Only .bbmodel files or ZIPs containing .bbmodel, .json, or texture files are accepted')
        return
      }

      if (skipped > 0) {
        onReject(`${skipped} unsupported or empty file(s) skipped`)
      }
    },
    [onFiles, onReject],
  )

  return (
    <div
      className={`relative w-full rounded-lg border-2 border-dashed text-center transition-all ${
        compact
          ? 'min-h-[180px] max-w-none p-6 sm:p-8'
          : 'min-h-[220px] max-w-xl p-6 sm:min-h-[280px] sm:p-12'
      } ${
        dragOver
          ? 'scale-[1.01] border-accent bg-accent/10 shadow-[0_0_0_1px_rgba(74,127,212,0.3)]'
          : 'border-border/80 bg-surface-elevated/30 hover:border-accent/40 hover:bg-surface-elevated/50'
      } ${disabled || expanding ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}
      onDragOver={(event) => {
        event.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragOver(false)
        if (!disabled) void handleFiles(event.dataTransfer.files)
      }}
      onClick={() => !disabled && !expanding && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          inputRef.current?.click()
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".bbmodel,.zip,application/zip"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files) void handleFiles(event.target.files)
          event.target.value = ''
        }}
      />

      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-base sm:h-14 sm:w-14">
        <UploadIcon active={dragOver} />
      </div>

      <h3 className={`font-medium text-text-primary ${compact ? 'text-sm' : 'text-base sm:text-lg'}`}>
        Drop .bbmodel or ZIP files here
      </h3>
      <p className={`mt-2 text-text-secondary ${compact ? 'text-xs' : 'text-sm'}`}>
        {expanding
          ? 'Extracting ZIP archive in chunks...'
          : 'or click to browse - ZIPs can include models, JSON, and textures'}
      </p>
    </div>
  )
}

function UploadIcon({ active }: { active: boolean }) {
  const color = active ? 'var(--accent)' : 'var(--text-secondary)'
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 16V8M8 12l4-4 4 4M4 20h16"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
