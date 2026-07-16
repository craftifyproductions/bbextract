import { processModelBuffer } from '../lib/parseModel'
import type { WorkerDebugStage, WorkerInboundMessage, WorkerOutboundMessage } from '../lib/types'

self.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  const message = event.data
  if (message.type !== 'processBuffer') return

  const post = (payload: WorkerOutboundMessage, transfer?: Transferable[]) => {
    if (transfer && transfer.length > 0) {
      self.postMessage(payload, { transfer })
      return
    }
    self.postMessage(payload)
  }

  const debug = (stage: WorkerDebugStage, data?: Record<string, unknown>) => {
    post({ type: 'debug', id: message.id, stage, data })
  }

  try {
    post({ type: 'progress', id: message.id, stage: 'parsing' })

    const { result, animationMeta, rawText, error } = processModelBuffer(
      message.buffer,
      message.filename,
      message.originalSizeBytes,
      (stage) => {
        debug(stage as WorkerDebugStage, { rawTextLength: message.buffer.byteLength })
      },
    )

    if (error || result.status === 'error') {
      post({
        type: 'error',
        id: message.id,
        message: result.error ?? error ?? 'Failed to parse model',
      })
      return
    }

    const { textureCount, animationCount, elementCount } = result.summary

    post({
      type: 'progress',
      id: message.id,
      stage: 'extracting_animations',
      textureCount,
      animationCount,
      elementCount,
    })

    post({ type: 'progress', id: message.id, stage: 'decoding_textures', textureCount })

    post({
      type: 'progress',
      id: message.id,
      stage: 'building_structure',
      elementCount,
      animationCount,
    })

    const transferables = result.textures.map((texture) => texture.blobBuffer)
    debug('beforeDone', {
      transferCount: transferables.length,
      transferBytes: transferables.reduce((sum, buffer) => sum + buffer.byteLength, 0),
      rawTextLength: rawText.length,
    })

    post({ type: 'done', id: message.id, result, animationMeta, rawText }, transferables)
    debug('afterDone')
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown processing error'
    post({ type: 'error', id: message.id, message: errorMessage })
  }
}
