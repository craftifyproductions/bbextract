export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

export interface SessionLogMeta {
  id: string
  filename: string
  createdAt: string
  userEmail?: string
  fileCount: number
  successCount: number
  errorCount: number
}

export interface SessionLogRecord extends SessionLogMeta {
  content: string
}

function timestamp(): string {
  return new Date().toISOString()
}

export function formatLogFilename(isoDate: string): string {
  const safe = isoDate.replace(/[:.]/g, '-')
  return `bbextract-${safe}.log`
}

export function createSessionLogger(userEmail?: string) {
  const id = crypto.randomUUID()
  const createdAt = timestamp()
  const lines: string[] = [
    `# BBExtract session log`,
    `# Started: ${createdAt}`,
    `# Session ID: ${id}`,
    `# User: ${userEmail || 'unknown'}`,
    '',
  ]

  let successCount = 0
  let errorCount = 0
  let fileCount = 0

  function append(level: LogLevel, message: string) {
    lines.push(`[${timestamp()}] [${level}] ${message}`)
  }

  function snapshot(): SessionLogRecord {
    return {
      id,
      filename: formatLogFilename(createdAt),
      createdAt,
      userEmail,
      fileCount,
      successCount,
      errorCount,
      content: lines.join('\n'),
    }
  }

  return {
    get id() {
      return id
    },
    get createdAt() {
      return createdAt
    },
    get filename() {
      return formatLogFilename(createdAt)
    },

    info(message: string) {
      append('INFO', message)
    },
    warn(message: string) {
      append('WARN', message)
    },
    error(message: string) {
      append('ERROR', message)
    },
    debug(message: string) {
      append('DEBUG', message)
    },

    startBatch(files: File[]) {
      fileCount = files.length
      append('INFO', `Upload batch started — ${files.length} file(s)`)
      for (const file of files) {
        append('INFO', `  Queued: ${file.name} (${file.size} bytes)`)
      }
    },

    fileStart(name: string, index: number, total: number) {
      append('INFO', `Processing file ${index}/${total}: ${name}`)
    },

    fileProgress(name: string, stage: string, detail?: string) {
      append('DEBUG', `  ${name} → ${stage}${detail ? ` (${detail})` : ''}`)
    },

    fileSuccess(
      name: string,
      stats: {
        elements: number
        bones: number
        textures: number
        animations: number
        extractedBytes: number
      },
    ) {
      successCount += 1
      append(
        'INFO',
        `  Completed: ${name} — ${stats.elements} elements, ${stats.bones} bones, ${stats.textures} textures, ${stats.animations} animations, ${stats.extractedBytes} bytes extracted`,
      )
    },

    fileFailure(name: string, message: string) {
      errorCount += 1
      append('ERROR', `  Failed: ${name} — ${message}`)
    },

    assetSuccess(
      name: string,
      stats: {
        kind: string
        bytes: number
        storagePath?: string
      },
    ) {
      successCount += 1
      append(
        'INFO',
        `  Uploaded ${stats.kind}: ${name} (${stats.bytes} bytes)${
          stats.storagePath ? ` → ${stats.storagePath}` : ''
        }`,
      )
    },

    assetFailure(name: string, message: string) {
      errorCount += 1
      append('ERROR', `  Failed asset upload: ${name} — ${message}`)
    },

    snapshot,

    finish(): SessionLogRecord {
      append('INFO', '')
      append(
        'INFO',
        `Session finished — ${successCount} succeeded, ${errorCount} failed, ${fileCount} total`,
      )
      return snapshot()
    },
  }
}

export type SessionLogger = ReturnType<typeof createSessionLogger>
