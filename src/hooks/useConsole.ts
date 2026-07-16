import { useCallback, useEffect, useRef, useState } from 'react'

export type ConsoleLevel = 'info' | 'warn' | 'error' | 'debug'

export interface ConsoleLine {
  id: string
  timestamp: string
  level: ConsoleLevel
  message: string
}

export function formatConsoleLine(line: ConsoleLine): string {
  return `[${line.timestamp}] [${line.level.toUpperCase()}] ${line.message}`
}

export function formatConsoleText(lines: ConsoleLine[]): string {
  return lines.map(formatConsoleLine).join('\n')
}

export interface ConsoleApi {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
  debug: (message: string) => void
  setBatchMode: (enabled: boolean) => void
}

const BUFFER_FLUSH_MS = 300

export function useConsole() {
  const [lines, setLines] = useState<ConsoleLine[]>([])
  const bufferRef = useRef<ConsoleLine[]>([])
  const bufferingRef = useRef(false)
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushBuffer = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }

    const pending = bufferRef.current
    if (pending.length === 0) return

    bufferRef.current = []
    setLines((prev) => [...prev, ...pending])
  }, [])

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null
      flushBuffer()
    }, BUFFER_FLUSH_MS)
  }, [flushBuffer])

  const append = useCallback(
    (level: ConsoleLevel, message: string) => {
      const line: ConsoleLine = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        level,
        message,
      }

      if (bufferingRef.current) {
        bufferRef.current.push(line)
        scheduleFlush()
        return
      }

      setLines((prev) => [...prev, line])
    },
    [scheduleFlush],
  )

  const setBuffering = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        bufferingRef.current = true
        return
      }

      bufferingRef.current = false
      flushBuffer()
    },
    [flushBuffer],
  )

  const api: ConsoleApi = {
    info: useCallback((message: string) => append('info', message), [append]),
    warn: useCallback((message: string) => append('warn', message), [append]),
    error: useCallback((message: string) => append('error', message), [append]),
    debug: useCallback((message: string) => append('debug', message), [append]),
    setBatchMode: setBuffering,
  }

  const clear = useCallback(() => {
    bufferRef.current = []
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    setLines([])
  }, [])

  const getText = useCallback(() => formatConsoleText(lines), [lines])

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current)
      }
    }
  }, [])

  return { lines, api, clear, getText }
}
