import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProcessingProgressDetail, ProcessingStage } from '../lib/types'

export interface QueueInfo {
  current: number
  total: number
}

export type UploadPhase = 'uploading'

export interface UploadInfo {
  phase: UploadPhase
  current: number
  total: number
}

type ProgressEntry = { stage: ProcessingStage } & ProcessingProgressDetail

export function useProcessingProgress() {
  const [progressMap, setProgressMap] = useState<Record<string, ProgressEntry>>({})
  const [queueInfo, setQueueInfo] = useState<QueueInfo | null>(null)
  const [uploadInfo, setUploadInfo] = useState<UploadInfo | null>(null)
  const [activeProcessingId, setActiveProcessingId] = useState<string | null>(null)

  const pendingRef = useRef<Map<string, ProgressEntry>>(new Map())
  const flushScheduledRef = useRef(false)

  const flushProgress = useCallback(() => {
    flushScheduledRef.current = false
    const pending = pendingRef.current
    if (pending.size === 0) return

    const updates = new Map(pending)
    pending.clear()

    setProgressMap((prev) => {
      const next = { ...prev }
      for (const [id, entry] of updates) {
        next[id] = entry
      }
      return next
    })
  }, [])

  const scheduleFlush = useCallback(() => {
    if (flushScheduledRef.current) return
    flushScheduledRef.current = true
    requestAnimationFrame(flushProgress)
  }, [flushProgress])

  const setProgress = useCallback(
    (id: string, stage: ProcessingStage, detail?: ProcessingProgressDetail) => {
      pendingRef.current.set(id, { stage, ...detail })
      scheduleFlush()
    },
    [scheduleFlush],
  )

  const clearProgress = useCallback((id: string) => {
    pendingRef.current.delete(id)
    setProgressMap((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const setQueuePosition = useCallback((current: number, total: number) => {
    setQueueInfo(total > 0 ? { current, total } : null)
  }, [])

  const clearQueue = useCallback(() => {
    setQueueInfo(null)
    setActiveProcessingId(null)
  }, [])

  const setUploadProgress = useCallback((current: number, total: number) => {
    setUploadInfo(total > 0 ? { phase: 'uploading', current, total } : null)
  }, [])

  const clearUploadProgress = useCallback(() => {
    setUploadInfo(null)
  }, [])

  const getProgress = useCallback(
    (id: string) => progressMap[id],
    [progressMap],
  )

  useEffect(() => {
    return () => {
      pendingRef.current.clear()
    }
  }, [])

  return {
    progressMap,
    queueInfo,
    uploadInfo,
    activeProcessingId,
    setActiveProcessingId,
    setProgress,
    clearProgress,
    setQueuePosition,
    clearQueue,
    setUploadProgress,
    clearUploadProgress,
    getProgress,
    isProcessing: queueInfo !== null,
    isUploading: uploadInfo !== null,
  }
}
