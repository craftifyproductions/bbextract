import { useCallback, useRef, useState } from 'react'
import { recordAuditEvent } from '../lib/auditLogStore'
import { sha256File } from '../lib/fileHash'
import { persistSessionLog } from '../lib/logStore'
import { processFileInWorker } from '../lib/processFileInWorker'
import { createSessionLogger, type SessionLogger } from '../lib/sessionLogger'
import {
  ensureExtractionRunForUpload,
  findExistingModelHashes,
  uploadDirectAssetFiles,
  uploadExtractedModelFiles,
  type UploadFailure,
} from '../lib/supabaseStorageStore'
import { UploadPreflightGate } from '../lib/uploadPreflight'
import { UploadCancelGate } from '../lib/uploadCancel'
import { duplicateSkipMessage, duplicateSkipReason } from '../lib/duplicateSkipMessages'
import type {
  DirectUploadAssetItem,
  ExtractedTexture,
  ModelUploadItem,
  ProcessedModel,
  ProcessingStage,
  UploadItem,
} from '../lib/types'
import type { ConsoleApi } from './useConsole'
import type { useProcessingProgress } from './useProcessingProgress'

export interface ProcessingError {
  filename: string
  message: string
  severity?: 'error' | 'warning' | 'info'
}

interface QueuedFile {
  file: File
  hash: string
  sourceArchive?: string
  originalPath?: string
  uploadBatchId?: string
  uploadBatchComplete?: boolean
}

async function yieldToMain(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') {
    await scheduler.yield()
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function createProcessingPlaceholder(file: File, fileHash?: string): ProcessedModel {
  return {
    id: crypto.randomUUID(),
    fileHash,
    folderName: file.name.replace(/\.bbmodel$/i, ''),
    originalFilename: file.name,
    originalSizeBytes: file.size,
    extractedSizeBytes: 0,
    metadata: { name: file.name.replace(/\.bbmodel$/i, '') },
    geometry: { elements: [], outliner: [] },
    textures: [],
    animations: [],
    summary: {
      elementCount: 0,
      cubeCount: 0,
      meshCount: 0,
      boneCount: 0,
      textureCount: 0,
      animationCount: 0,
      totalKeyframes: 0,
      originalFilename: file.name,
      extractedAt: new Date().toISOString(),
    },
    status: 'processing',
    progress: 'parsing',
  }
}

function formatProgressDetail(
  stage: ProcessingStage,
  detail?: {
    textureCount?: number
    animationCount?: number
    elementCount?: number
    checkpoint?: string
  },
): string | undefined {
  if (!detail) return undefined
  if (detail.checkpoint) return detail.checkpoint
  if (stage === 'decoding_textures' && detail.textureCount != null) {
    return `${detail.textureCount} texture(s)`
  }
  if (stage === 'extracting_animations' && detail.animationCount != null) {
    return `${detail.animationCount} animation(s)`
  }
  if (stage === 'building_structure') {
    const parts: string[] = []
    if (detail.elementCount != null) parts.push(`${detail.elementCount} elements`)
    if (detail.animationCount != null) parts.push(`${detail.animationCount} animation(s)`)
    return parts.length > 0 ? parts.join(', ') : undefined
  }
  return undefined
}

function formatArchiveDetail(item: { sourceArchive?: string; originalPath?: string }): string {
  if (!item.sourceArchive) return ''
  return item.originalPath ? ` from ${item.sourceArchive}:${item.originalPath}` : ` from ${item.sourceArchive}`
}

function logArchiveSegregation(
  items: Array<Pick<UploadItem, 'kind' | 'sourceArchive'> & { assetKind?: string }>,
  logger: SessionLogger | null,
  consoleApi: ConsoleApi,
) {
  const archiveCounts = new Map<string, { models: number; textures: number; json: number }>()

  for (const item of items) {
    if (!item.sourceArchive) continue
    const counts = archiveCounts.get(item.sourceArchive) ?? { models: 0, textures: 0, json: 0 }
    if (item.kind === 'model') counts.models += 1
    if (item.assetKind === 'texture') counts.textures += 1
    if (item.assetKind === 'json') counts.json += 1
    archiveCounts.set(item.sourceArchive, counts)
  }

  for (const [archive, counts] of archiveCounts) {
    const parts = [
      `${counts.models} model(s)`,
      `${counts.textures} texture(s)`,
      `${counts.json} JSON file(s)`,
    ]
    const message = `ZIP segregated: ${archive} — ${parts.join(', ')}`
    logger?.info(message)
    consoleApi.info(message)
    void recordAuditEvent('zip_upload_segregated', archive, counts)
  }
}

type ProcessingProgressApi = Pick<
  ReturnType<typeof useProcessingProgress>,
  | 'setProgress'
  | 'clearProgress'
  | 'setQueuePosition'
  | 'clearQueue'
  | 'setActiveProcessingId'
  | 'setUploadProgress'
  | 'clearUploadProgress'
>

export function useFileProcessor(
  addModel: (model: ProcessedModel) => void,
  commitModel: (
    id: string,
    patch: Partial<ProcessedModel> & { assetTextures?: ExtractedTexture[] },
  ) => void,
  onError: (error: ProcessingError) => void,
  progressApi: ProcessingProgressApi,
  consoleApi: ConsoleApi,
  authenticated: boolean,
  userEmail?: string | null,
  onLogSaved?: () => void,
) {
  const queueRef = useRef<QueuedFile[]>([])
  const totalQueuedRef = useRef(0)
  const processedCountRef = useRef(0)
  const drainingRef = useRef(false)
  const sessionLoggerRef = useRef<SessionLogger | null>(null)
  const batchFilesRef = useRef<File[]>([])
  const completedModelsRef = useRef<ProcessedModel[]>([])
  const directAssetsRef = useRef<DirectUploadAssetItem[]>([])
  const knownHashesRef = useRef<Set<string>>(new Set())
  const queuedHashesRef = useRef<Set<string>>(new Set())
  const finalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingUploadBatchIdsRef = useRef<Set<string>>(new Set())
  const preflightGateRef = useRef(new UploadPreflightGate())
  const uploadCancelRef = useRef(new UploadCancelGate())
  const isFinalizingRef = useRef(false)
  const isUploadActiveRef = useRef(false)
  const [isUploadActive, setIsUploadActive] = useState(false)

  const isUploadCancelled = useCallback(() => uploadCancelRef.current.isCancelled, [])

  const resetSessionAfterCancel = useCallback(() => {
    isUploadActiveRef.current = false
    setIsUploadActive(false)
    sessionLoggerRef.current = null
    batchFilesRef.current = []
    completedModelsRef.current = []
    directAssetsRef.current = []
    queueRef.current = []
    pendingUploadBatchIdsRef.current.clear()
    queuedHashesRef.current.clear()
    totalQueuedRef.current = 0
    processedCountRef.current = 0
    progressApi.clearQueue()
    progressApi.clearUploadProgress()
    preflightGateRef.current.reset()
  }, [progressApi])

  const beginUploadSession = useCallback(() => {
    uploadCancelRef.current.reset()
    isUploadActiveRef.current = true
    setIsUploadActive(true)
  }, [])

  const cancelUpload = useCallback(() => {
    const hasActiveWork =
      isUploadActiveRef.current ||
      queueRef.current.length > 0 ||
      drainingRef.current ||
      pendingUploadBatchIdsRef.current.size > 0 ||
      sessionLoggerRef.current !== null

    if (!hasActiveWork) return

    uploadCancelRef.current.cancel()
    if (finalizeTimerRef.current) {
      clearTimeout(finalizeTimerRef.current)
      finalizeTimerRef.current = null
    }
    queueRef.current = []
    pendingUploadBatchIdsRef.current.clear()
    directAssetsRef.current = []
    queuedHashesRef.current.clear()
    sessionLoggerRef.current?.warn('Upload cancelled by user')
    consoleApi.warn('Upload cancelled by user')
    void recordAuditEvent('upload_cancelled', 'Upload session')
    resetSessionAfterCancel()
  }, [consoleApi, resetSessionAfterCancel])

  const shouldCancelUpload = useCallback(() => uploadCancelRef.current.isCancelled, [])

  const reportPreflightFailure = useCallback(
    (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Upload persistence preflight failed'
      consoleApi.error(`Upload preflight failed — ${message}`)
      onError({ filename: 'upload-preflight', message })
      void recordAuditEvent('upload_preflight_failed', 'Storage', { message })
      return false
    },
    [consoleApi, onError],
  )

  const prepareUpload = useCallback(async (): Promise<boolean> => {
    try {
      await preflightGateRef.current.ensureReady()
      return true
    } catch (err) {
      return reportPreflightFailure(err)
    }
  }, [reportPreflightFailure])

  const filterDuplicateFiles = useCallback(
    async (items: ModelUploadItem[]): Promise<QueuedFile[]> => {
      const hashedFiles = await Promise.all(
        items.map(async (item) => ({ ...item, hash: await sha256File(item.file) })),
      )
      const hashes = hashedFiles.map((entry) => entry.hash)
      const existingHashes = await findExistingModelHashes(hashes)
      const batchHashes = new Set<string>()
      const uniqueFiles: QueuedFile[] = []

      for (const entry of hashedFiles) {
        const inLibrary = existingHashes.has(entry.hash)
        const inZip =
          batchHashes.has(entry.hash) ||
          queuedHashesRef.current.has(entry.hash) ||
          knownHashesRef.current.has(entry.hash)

        if (inLibrary || inZip) {
          const reason = duplicateSkipReason(inLibrary)
          const message = duplicateSkipMessage(entry.file.name, reason)
          sessionLoggerRef.current?.warn(message)
          consoleApi.warn(message)
          onError({ filename: entry.file.name, message, severity: 'warning' })
          void recordAuditEvent('duplicate_upload_blocked', entry.file.name, {
            fileHash: entry.hash,
            size: entry.file.size,
            reason,
          })
          continue
        }

        batchHashes.add(entry.hash)
        uniqueFiles.push({
          file: entry.file,
          hash: entry.hash,
          sourceArchive: entry.sourceArchive,
          originalPath: entry.originalPath,
          uploadBatchId: entry.uploadBatchId,
          uploadBatchComplete: entry.uploadBatchComplete,
        })
      }

      return uniqueFiles
    },
    [consoleApi, onError],
  )

  const finalizeSessionLog = useCallback(async () => {
    if (finalizeTimerRef.current) {
      clearTimeout(finalizeTimerRef.current)
      finalizeTimerRef.current = null
    }

    if (uploadCancelRef.current.isCancelled) {
      resetSessionAfterCancel()
      return
    }

    const logger = sessionLoggerRef.current
    if (!logger) return

    isFinalizingRef.current = true

    sessionLoggerRef.current = null
    batchFilesRef.current = []
    const completedModels = completedModelsRef.current
    completedModelsRef.current = []
    const directAssets = directAssetsRef.current
    directAssetsRef.current = []

    const markCompletedModelsPersistenceFailed = (message: string) => {
      for (const model of completedModels) {
        commitModel(model.id, {
          status: 'error',
          progress: 'error',
          error: message,
        })
        onError({ filename: model.originalFilename, message })
      }
    }

    const reportUploadFailures = (label: string, failures: UploadFailure[]) => {
      if (failures.length === 0) return
      const summary = `${failures.length} ${label} could not be saved`
      logger.warn(summary)
      consoleApi.warn(summary)
      for (const failure of failures) {
        logger.assetFailure(failure.name, failure.message)
        consoleApi.error(`  ${failure.name} — ${failure.message}`)
      }
      void recordAuditEvent('upload_items_failed', label, {
        count: failures.length,
        samples: failures.slice(0, 10),
      })
    }

    const doneModelCount = completedModels.filter((model) => model.status === 'done').length
    const totalUploadUnits = directAssets.length + doneModelCount
    let uploadedUnits = 0
    const reportUploadProgress = () => {
      uploadedUnits += 1
      progressApi.setUploadProgress(uploadedUnits, totalUploadUnits)
    }
    if (totalUploadUnits > 0) {
      progressApi.setUploadProgress(0, totalUploadUnits)
    }

    try {
      const initialRecord = logger.snapshot()
      let persistenceError: string | null = null

      if (uploadCancelRef.current.isCancelled) {
        logger.warn('Upload cancelled before persistence')
        consoleApi.warn('Upload cancelled before persistence')
        resetSessionAfterCancel()
        return
      }

      try {
        await ensureExtractionRunForUpload(initialRecord)
      } catch (runErr) {
        const message =
          runErr instanceof Error
            ? runErr.message
            : 'Could not create extraction run in Supabase'
        logger.error(message)
        consoleApi.error(message)
        persistenceError = message
      }

      // Full session log is best-effort — never block file/model uploads on it.
      void persistSessionLog(initialRecord, authenticated).then((target) => {
        if (target !== 'supabase') {
          consoleApi.warn(`Session log saved to ${target} (full log may be incomplete)`)
        }
      })

      const doneModels = completedModels.filter((model) => model.status === 'done')
      if (doneModels.length === 0 && directAssets.length === 0) {
        consoleApi.warn('Upload session finished with nothing to persist')
      } else {
        consoleApi.info(
          `Persisting upload — ${doneModels.length} model(s), ${directAssets.length} direct asset(s)`,
        )
      }

      // Asset and model persistence are independent: a failing texture must never
      // stop the model registry (extracted_models) from being written.
      if (!persistenceError) {
        try {
          const directAssetResult = await uploadDirectAssetFiles(
            initialRecord,
            directAssets,
            completedModels,
            ({ item, storagePath }) => {
              if (uploadCancelRef.current.isCancelled) return
              logger.assetSuccess(item.file.name, {
                kind: item.assetKind,
                bytes: item.file.size,
                storagePath,
              })
              consoleApi.info(
                `Uploaded ${item.assetKind}: ${item.file.name}${formatArchiveDetail(item)} → ${storagePath}`,
              )
            },
            reportUploadProgress,
            shouldCancelUpload,
          )
          if (uploadCancelRef.current.isCancelled) {
            logger.warn('Upload cancelled during asset persistence')
            consoleApi.warn('Upload cancelled during asset persistence')
            resetSessionAfterCancel()
            return
          }
          const uploadedAssetCount = directAssetResult.uploadedCount
          if (uploadedAssetCount > 0) {
            void recordAuditEvent('uploaded_direct_zip_assets', `${uploadedAssetCount} file(s)`, {
              runId: initialRecord.id,
              fileCount: uploadedAssetCount,
            })
          } else if (directAssets.length > 0) {
            const message = 'ZIP assets were not uploaded'
            logger.warn(message)
            consoleApi.warn(message)
          }
          reportUploadFailures('ZIP asset(s)', directAssetResult.failures)
        } catch (assetErr) {
          console.error('[BBExtract] Failed to upload ZIP assets:', assetErr)
          const message = assetErr instanceof Error ? assetErr.message : 'Unknown storage error'
          logger.assetFailure('ZIP assets', message)
          consoleApi.error(`Failed to upload ZIP assets — ${message}`)
          void recordAuditEvent('upload_zip_assets_failed', 'Storage', {
            runId: initialRecord.id,
            message,
          })
        }
      }

      if (!persistenceError) {
        try {
          const extractedUploadResult = await uploadExtractedModelFiles(
            initialRecord,
            completedModels,
            reportUploadProgress,
            shouldCancelUpload,
          )
          if (uploadCancelRef.current.isCancelled) {
            logger.warn('Upload cancelled during model persistence')
            consoleApi.warn('Upload cancelled during model persistence')
            resetSessionAfterCancel()
            return
          }
          const { uploadedCount, savedModelCount, failures } = extractedUploadResult
          if (uploadedCount > 0) {
            logger.info(
              `Saved ${savedModelCount} model(s) and ${uploadedCount} extracted model file(s)`,
            )
            consoleApi.info(
              `Saved ${savedModelCount} model(s) and ${uploadedCount} extracted file(s)`,
            )
            void recordAuditEvent('uploaded_extracted_files', `${uploadedCount} file(s)`, {
              runId: initialRecord.id,
              modelCount: completedModels.length,
              savedModelCount,
              fileCount: uploadedCount,
            })
          } else if (doneModels.length > 0) {
            const message = 'No extracted model files were saved to storage'
            logger.warn(message)
            consoleApi.warn(message)
          }
          if (doneModels.length > 0 && savedModelCount === 0) {
            consoleApi.warn(
              'Saved library model count will stay at 0 until at least one model archive is stored',
            )
          }
          reportUploadFailures('model(s)', failures)
          const failedModelNames = new Set(
            extractedUploadResult.failures.map((failure) => failure.name),
          )
          for (const model of completedModels) {
            if (!failedModelNames.has(model.originalFilename)) continue
            const message = 'Model files could not be saved to storage'
            commitModel(model.id, { status: 'error', progress: 'error', error: message })
            onError({ filename: model.originalFilename, message })
          }
        } catch (storageErr) {
          console.error('[BBExtract] Failed to upload extracted files:', storageErr)
          const message = storageErr instanceof Error ? storageErr.message : 'Unknown storage error'
          logger.assetFailure('extracted model files', message)
          consoleApi.error(`Failed to save extracted files — ${message}`)
          persistenceError = `Model file persistence failed: ${message}`
          void recordAuditEvent('upload_to_storage_failed', 'Storage', {
            runId: initialRecord.id,
            message,
          })
        }
      }

      const record = logger.finish()
      consoleApi.info(
        `Session finished — ${record.successCount} succeeded, ${record.errorCount} failed, ${record.fileCount} total`,
      )
      const target = await persistSessionLog(record, authenticated)
      if (target !== 'supabase') {
        const message = `Final session log saved to ${target}, not Supabase`
        logger.error(message)
        persistenceError = persistenceError ?? message
      }
      consoleApi.info(`Session log saved (${target}) — view in Dashboard → Logs`)
      if (persistenceError) {
        markCompletedModelsPersistenceFailed(persistenceError)
        consoleApi.error(`Upload persistence failed — ${persistenceError}`)
      }
      onLogSaved?.()
    } catch (err) {
      console.error('[BBExtract] Failed to save session log:', err)
      const message = err instanceof Error ? err.message : 'Failed to save session log'
      markCompletedModelsPersistenceFailed(message)
      consoleApi.error(`Upload persistence failed — ${message}`)
    } finally {
      isFinalizingRef.current = false
      progressApi.clearUploadProgress()
      preflightGateRef.current.reset()
      sessionLoggerRef.current = null
      batchFilesRef.current = []
      completedModelsRef.current = []
      directAssetsRef.current = []
      isUploadActiveRef.current = false
      setIsUploadActive(false)
    }
  }, [
    authenticated,
    commitModel,
    consoleApi,
    onError,
    onLogSaved,
    progressApi,
    resetSessionAfterCancel,
    shouldCancelUpload,
  ])

  const scheduleFinalizeSessionLog = useCallback(() => {
    if (uploadCancelRef.current.isCancelled) {
      resetSessionAfterCancel()
      return
    }

    if (pendingUploadBatchIdsRef.current.size > 0 || queueRef.current.length > 0 || drainingRef.current) {
      return
    }

    if (finalizeTimerRef.current) {
      clearTimeout(finalizeTimerRef.current)
    }

    finalizeTimerRef.current = setTimeout(() => {
      finalizeTimerRef.current = null
      void finalizeSessionLog()
    }, 1500)
  }, [finalizeSessionLog, resetSessionAfterCancel])

  const drainQueue = useCallback(async () => {
    if (drainingRef.current) return
    drainingRef.current = true

    consoleApi.setBatchMode(true)

    try {
      while (queueRef.current.length > 0) {
        if (uploadCancelRef.current.isCancelled) break

        const queued = queueRef.current.shift()!
        const { file } = queued
        processedCountRef.current += 1

        const currentIndex = processedCountRef.current
        const totalCount = totalQueuedRef.current

        progressApi.setQueuePosition(currentIndex, totalCount)

        const placeholder = createProcessingPlaceholder(file, queued.hash)
        progressApi.setActiveProcessingId(placeholder.id)
        progressApi.setProgress(placeholder.id, 'parsing')
        addModel(placeholder)

        sessionLoggerRef.current?.fileStart(file.name, currentIndex, totalCount)
        consoleApi.info(`Processing file ${currentIndex}/${totalCount}: ${file.name}`)
        if (queued.sourceArchive) {
          sessionLoggerRef.current?.info(`  Source: ${queued.sourceArchive}/${queued.originalPath ?? file.name}`)
          consoleApi.info(`  Source: ${queued.sourceArchive}/${queued.originalPath ?? file.name}`)
        }

        try {
          if (uploadCancelRef.current.isCancelled) break

          const { assetTextures, ...result } = await processFileInWorker(
            file,
            placeholder.id,
            (stage, detail) => {
              progressApi.setProgress(placeholder.id, stage, detail)
              const detailText = formatProgressDetail(stage, detail)
              sessionLoggerRef.current?.fileProgress(file.name, stage, detailText)
              consoleApi.debug(
                `  ${file.name} → ${stage}${detailText ? ` (${detailText})` : ''}`,
              )
            },
          )

          if (result.status === 'error') {
            commitModel(placeholder.id, {
              ...result,
              status: 'error',
              progress: 'error',
            })
            sessionLoggerRef.current?.fileFailure(
              file.name,
              result.error ?? `${file.name} failed to parse`,
            )
            consoleApi.error(
              `  Failed: ${file.name} — ${result.error ?? `${file.name} failed to parse`}`,
            )
            onError({
              filename: file.name,
              message: result.error ?? `${file.name} failed to parse`,
            })
          } else {
            const completedModel = {
              ...result,
              fileHash: queued.hash,
              sourceArchive: queued.sourceArchive,
              originalPath: queued.originalPath,
            }
            commitModel(placeholder.id, { ...completedModel, assetTextures })
            completedModelsRef.current.push(completedModel)
            knownHashesRef.current.add(queued.hash)
            sessionLoggerRef.current?.fileSuccess(file.name, {
              elements: result.summary.elementCount,
              bones: result.summary.boneCount,
              textures: result.summary.textureCount,
              animations: result.summary.animationCount,
              extractedBytes: result.extractedSizeBytes,
            })
            consoleApi.info(
              `  Completed: ${file.name} — ${result.summary.elementCount} elements, ${result.summary.boneCount} bones, ${result.summary.textureCount} textures, ${result.summary.animationCount} animations, ${result.extractedSizeBytes} bytes extracted`,
            )
            if (result.summary.warnings?.length) {
              for (const warning of result.summary.warnings) {
                sessionLoggerRef.current?.warn(`  ${file.name}: ${warning}`)
                consoleApi.warn(`  ${file.name}: ${warning}`)
              }
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown processing error'
          commitModel(placeholder.id, {
            status: 'error',
            progress: 'error',
            error: message,
          })
          sessionLoggerRef.current?.fileFailure(file.name, message)
          consoleApi.error(`  Failed: ${file.name} — ${message}`)
          onError({ filename: file.name, message })
        } finally {
          queuedHashesRef.current.delete(queued.hash)
          progressApi.clearProgress(placeholder.id)
        }

        await yieldToMain()
      }
    } finally {
      drainingRef.current = false
      if (uploadCancelRef.current.isCancelled) {
        processedCountRef.current = 0
        totalQueuedRef.current = 0
        progressApi.clearQueue()
        consoleApi.setBatchMode(false)
        resetSessionAfterCancel()
        return
      }
      processedCountRef.current = 0
      totalQueuedRef.current = 0
      progressApi.clearQueue()
      consoleApi.setBatchMode(false)
      scheduleFinalizeSessionLog()
    }
  }, [
    addModel,
    commitModel,
    consoleApi,
    onError,
    progressApi,
    resetSessionAfterCancel,
    scheduleFinalizeSessionLog,
  ])

  const processFiles = useCallback(
    async (items: UploadItem[]) => {
      if (items.length === 0) return

      if (uploadCancelRef.current.isCancelled) return

      if (finalizeTimerRef.current) {
        clearTimeout(finalizeTimerRef.current)
        finalizeTimerRef.current = null
      }

      for (const item of items) {
        if (!item.uploadBatchId) continue
        if (item.uploadBatchComplete) {
          pendingUploadBatchIdsRef.current.delete(item.uploadBatchId)
        } else {
          pendingUploadBatchIdsRef.current.add(item.uploadBatchId)
        }
      }

      const modelItems = items.filter((item): item is ModelUploadItem => item.kind === 'model')
      const assetItems = items.filter(
        (item): item is DirectUploadAssetItem => item.kind === 'asset',
      )

      const wasIdle =
        !sessionLoggerRef.current && totalQueuedRef.current === 0 && !drainingRef.current

      if (wasIdle && !preflightGateRef.current.isReady) {
        try {
          await preflightGateRef.current.ensureReady()
        } catch (err) {
          reportPreflightFailure(err)
          return
        }
      }

      let uniqueFiles: QueuedFile[]
      try {
        uniqueFiles = await filterDuplicateFiles(modelItems)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to check duplicate uploads'
        consoleApi.error(message)
        onError({ filename: 'duplicate-check', message })
        return
      }

      if (uniqueFiles.length === 0 && assetItems.length === 0) return
      const rawFiles = uniqueFiles.map((entry) => entry.file)
      const rawAssetFiles = assetItems.map((entry) => entry.file)
      const allQueuedFiles = [...rawFiles, ...rawAssetFiles]
      const archiveItemsForLog: UploadItem[] = [
        ...uniqueFiles.map((entry) => ({
          kind: 'model' as const,
          file: entry.file,
          sourceArchive: entry.sourceArchive,
          originalPath: entry.originalPath,
          uploadBatchId: entry.uploadBatchId,
          uploadBatchComplete: entry.uploadBatchComplete,
        })),
        ...assetItems,
      ]

      if (wasIdle) {
        if (uploadCancelRef.current.isCancelled) return
        if (!isUploadActiveRef.current) {
          uploadCancelRef.current.reset()
          isUploadActiveRef.current = true
          setIsUploadActive(true)
        }
        sessionLoggerRef.current = createSessionLogger(userEmail ?? undefined)
        batchFilesRef.current = [...allQueuedFiles]
        sessionLoggerRef.current.startBatch(allQueuedFiles)
        consoleApi.info(
          `Upload batch started by ${userEmail || 'unknown user'} — ${allQueuedFiles.length} file(s)`,
        )
        void recordAuditEvent('upload_batch_started', `${allQueuedFiles.length} file(s)`, {
          files: allQueuedFiles.map((file) => ({ name: file.name, size: file.size })),
        })
        for (const file of allQueuedFiles) {
          consoleApi.info(`  Queued: ${file.name} (${file.size} bytes)`)
        }
        logArchiveSegregation(archiveItemsForLog, sessionLoggerRef.current, consoleApi)
      } else {
        batchFilesRef.current.push(...allQueuedFiles)
        sessionLoggerRef.current?.info(
          `Additional files queued — ${allQueuedFiles.length} file(s) appended to session`,
        )
        consoleApi.info(
          `Additional files queued — ${allQueuedFiles.length} file(s) appended to session`,
        )
        for (const file of allQueuedFiles) {
          sessionLoggerRef.current?.info(`  Queued: ${file.name} (${file.size} bytes)`)
          consoleApi.info(`  Queued: ${file.name} (${file.size} bytes)`)
        }
        logArchiveSegregation(archiveItemsForLog, sessionLoggerRef.current, consoleApi)
      }

      directAssetsRef.current.push(...assetItems)
      totalQueuedRef.current += uniqueFiles.length
      queueRef.current.push(...uniqueFiles)
      for (const entry of uniqueFiles) {
        queuedHashesRef.current.add(entry.hash)
      }

      if (wasIdle) {
        progressApi.setQueuePosition(0, totalQueuedRef.current)
      } else if (totalQueuedRef.current > 1) {
        progressApi.setQueuePosition(processedCountRef.current, totalQueuedRef.current)
      }

      if (uniqueFiles.length > 0) {
        void drainQueue()
      } else {
        scheduleFinalizeSessionLog()
      }
    },
    [
      consoleApi,
      drainQueue,
      filterDuplicateFiles,
      onError,
      progressApi,
      reportPreflightFailure,
      scheduleFinalizeSessionLog,
      userEmail,
    ],
  )

  return {
    processFiles,
    prepareUpload,
    beginUploadSession,
    cancelUpload,
    isUploadActive,
    isUploadCancelled,
  }
}
