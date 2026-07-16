import { modelDataStore } from './modelDataStore'
import { hydrateWorkerModel } from './parseModel'
import type {
  ProcessedModel,
  ProcessingProgressDetail,
  ProcessingStage,
  WorkerOutboundMessage,
} from './types'

const BASE_WORKER_TIMEOUT_MS = 120_000

function computeWorkerTimeoutMs(fileSizeBytes: number): number {
  return Math.max(BASE_WORKER_TIMEOUT_MS, (fileSizeBytes / 1024) * 100)
}

const DEBUG_RELAY_ENABLED =
  typeof import.meta !== 'undefined' && import.meta.env?.DEV === true

function relayWorkerDebug(
  filename: string,
  message: Extract<WorkerOutboundMessage, { type: 'debug' }>,
): void {
  if (!DEBUG_RELAY_ENABLED) return
  console.debug(
    `[BBExtract:worker] ${filename} → ${message.stage}`,
    message.data ?? {},
  )
}

function createParseWorker(): Worker {
  return new Worker(new URL('../workers/parseWorker.ts', import.meta.url), {
    type: 'module',
  })
}

export function processFileInWorker(
  file: File,
  modelId: string,
  onProgress: (stage: ProcessingStage, detail?: ProcessingProgressDetail) => void,
): Promise<ProcessedModel & { assetTextures?: ReturnType<typeof hydrateWorkerModel>['assetTextures'] }> {
  return new Promise((resolve, reject) => {
    const requestId = modelId
    const parseWorker = createParseWorker()
    const workerTimeoutMs = computeWorkerTimeoutMs(file.size)
    let settled = false

    const cleanup = () => {
      clearTimeout(timeoutId)
      parseWorker.removeEventListener('message', handleMessage)
      parseWorker.removeEventListener('error', handleError)
      parseWorker.terminate()
    }

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }

    const timeoutId = setTimeout(() => {
      const rawTextBytes = modelDataStore.totalRawTextBytes()
      settle(() =>
        reject(
          new Error(
            `Processing timed out after ${workerTimeoutMs / 1000}s for ${file.name} (storeRawTextBytes=${rawTextBytes})`,
          ),
        ),
      )
    }, workerTimeoutMs)

    const handleMessage = (event: MessageEvent<WorkerOutboundMessage>) => {
      const message = event.data
      if (message.id !== requestId) return

      if (message.type === 'debug') {
        relayWorkerDebug(file.name, message)
        onProgress('parsing', {
          checkpoint: message.stage,
          ...(message.data as ProcessingProgressDetail | undefined),
        })
        return
      }

      if (message.type === 'progress') {
        const { stage, textureCount, animationCount, elementCount } = message
        onProgress(stage, { textureCount, animationCount, elementCount })
        return
      }

      if (message.type === 'error') {
        settle(() => reject(new Error(message.message)))
        return
      }

      settle(() => {
        const hydrated = hydrateWorkerModel(
          message.result,
          modelId,
          file.size,
          message.rawText,
          message.animationMeta,
        )
        resolve({ ...hydrated.model, assetTextures: hydrated.assetTextures })
      })
    }

    const handleError = () => {
      settle(() => reject(new Error('Worker failed to process file')))
    }

    parseWorker.addEventListener('message', handleMessage)
    parseWorker.addEventListener('error', handleError)

    void file.arrayBuffer().then(
      (buffer) => {
        onProgress('parsing')

        parseWorker.postMessage(
          {
            type: 'processBuffer',
            id: requestId,
            filename: file.name,
            originalSizeBytes: file.size,
            buffer,
          },
          { transfer: [buffer] },
        )
      },
      (error) => {
        settle(() =>
          reject(error instanceof Error ? error : new Error('Failed to read file')),
        )
      },
    )
  })
}

export { computeWorkerTimeoutMs, BASE_WORKER_TIMEOUT_MS }
