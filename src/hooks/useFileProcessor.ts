import { useCallback, useRef } from 'react'
import { checkR2Health } from '../lib/api'
import { recordAuditEvent } from '../lib/auditLogStore'
import { sha256File } from '../lib/fileHash'
import { persistSessionLog } from '../lib/logStore'
import { processFileInWorker } from '../lib/processFileInWorker'
import { createSessionLogger, type SessionLogger } from '../lib/sessionLogger'
import { getSupabaseClient } from '../lib/supabaseClient'
import {
  findExistingModelHashes,
  uploadDirectAssetFiles,
  uploadExtractedModelFiles,
} from '../lib/supabaseStorageStore'
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
}

interface QueuedFile {
  file: File
  hash: string
  sourceArchive?: string
  originalPath?: string
  uploadBatchId?: string
  uploadBatchComplete?: boolean
}

const UPLOAD_PREFLIGHT_TABLES = ['extraction_runs', 'extracted_models', 'extracted_files'] as const

async function yieldToMain(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') {
    await scheduler.yield()
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function assertUploadPersistenceReady(): Promise<void> {
  const supabase = await getSupabaseClient()
  if (!supabase) {
    throw new Error('Supabase is not configured. Upload persistence is unavailable.')
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw new Error(`Supabase session check failed: ${sessionError.message}`)
  if (!sessionData.session) {
    throw new Error('Sign in to Supabase before uploading files.')
  }

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw new Error(`Supabase session verification failed: ${userError.message}`)
  if (!userData.user) {
    throw new Error('Supabase session verification failed. Sign in again before uploading files.')
  }

  for (const table of UPLOAD_PREFLIGHT_TABLES) {
    const { error } = await supabase.from(table).select('id').limit(1)
    if (error) {
      throw new Error(`Supabase ${table} table is not reachable: ${error.message}`)
    }
  }

  const health = await checkR2Health()
  if (!health.ok) {
    throw new Error('Cloudflare R2 health check failed.')
  }
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
        const duplicate =
          existingHashes.has(entry.hash) ||
          knownHashesRef.current.has(entry.hash) ||
          queuedHashesRef.current.has(entry.hash) ||
          batchHashes.has(entry.hash)

        if (duplicate) {
          const message = `${entry.file.name} already exists and was skipped`
          consoleApi.warn(message)
          onError({ filename: entry.file.name, message })
          void recordAuditEvent('duplicate_upload_blocked', entry.file.name, {
            fileHash: entry.hash,
            size: entry.file.size,
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

    const logger = sessionLoggerRef.current
    if (!logger) return

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

    try {
      const initialRecord = logger.snapshot()
      const initialLogTarget = await persistSessionLog(initialRecord, authenticated)
      let persistenceError: string | null = null

      if (initialLogTarget !== 'supabase') {
        const message = `Supabase log save did not succeed; saved to ${initialLogTarget} instead`
        logger.error(message)
        consoleApi.error(message)
        persistenceError = message
      }

      if (!persistenceError) {
        try {
          const directAssetResult = await uploadDirectAssetFiles(
            initialRecord,
            directAssets,
            ({ item, storagePath }) => {
              logger.assetSuccess(item.file.name, {
                kind: item.assetKind,
                bytes: item.file.size,
                storagePath,
              })
              consoleApi.info(
                `Uploaded ${item.assetKind}: ${item.file.name}${formatArchiveDetail(item)} → ${storagePath}`,
              )
            },
          )
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
        } catch (assetErr) {
          console.error('[BBExtract] Failed to upload ZIP assets:', assetErr)
          const message = assetErr instanceof Error ? assetErr.message : 'Unknown storage error'
          logger.assetFailure('ZIP assets', message)
          consoleApi.error(`Failed to upload ZIP assets — ${message}`)
          persistenceError = `ZIP asset persistence failed: ${message}`
          void recordAuditEvent('upload_zip_assets_failed', 'Storage', {
            runId: initialRecord.id,
            message,
          })
        }
      }

      if (!persistenceError) {
        try {
          const extractedUploadResult = await uploadExtractedModelFiles(initialRecord, completedModels)
          const uploadedCount = extractedUploadResult.uploadedCount
          if (uploadedCount > 0) {
            logger.info(`Saved ${uploadedCount} extracted model file(s)`)
            consoleApi.info(`Saved ${uploadedCount} extracted file(s)`)
            void recordAuditEvent('uploaded_extracted_files', `${uploadedCount} file(s)`, {
              runId: initialRecord.id,
              modelCount: completedModels.length,
              fileCount: uploadedCount,
            })
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
    }
  }, [authenticated, commitModel, consoleApi, onError, onLogSaved])

  const scheduleFinalizeSessionLog = useCallback(() => {
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
  }, [finalizeSessionLog])

  const drainQueue = useCallback(async () => {
    if (drainingRef.current) return
    drainingRef.current = true

    consoleApi.setBatchMode(true)

    try {
      while (queueRef.current.length > 0) {
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
            const completedModel = { ...result, fileHash: queued.hash }
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
      processedCountRef.current = 0
      totalQueuedRef.current = 0
      progressApi.clearQueue()
      consoleApi.setBatchMode(false)
      scheduleFinalizeSessionLog()
    }
  }, [addModel, commitModel, consoleApi, onError, progressApi, scheduleFinalizeSessionLog])

  const processFiles = useCallback(
    async (items: UploadItem[]) => {
      if (items.length === 0) return

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

      try {
        await assertUploadPersistenceReady()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload persistence preflight failed'
        consoleApi.error(`Upload preflight failed — ${message}`)
        onError({ filename: 'upload-preflight', message })
        void recordAuditEvent('upload_preflight_failed', 'Storage', { message })
        return
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

      const wasIdle =
        !sessionLoggerRef.current && totalQueuedRef.current === 0 && !drainingRef.current

      if (wasIdle) {
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
    [consoleApi, drainQueue, filterDuplicateFiles, onError, progressApi, scheduleFinalizeSessionLog, userEmail],
  )

  return { processFiles }
}
