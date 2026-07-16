import { describe, expect, it, beforeEach } from 'vitest'
import { extractHeavyFromRawText } from '../extractHeavyFromRawText'
import { modelDataStore } from '../modelDataStore'
import {
  decodeTexturesInWorker,
  hydrateWorkerModel,
  parseModelFromObject,
  prepareWorkerInputFromParsed,
  processModelBuffer,
  workerTexturesToExtracted,
} from '../parseModel'
import { buildModelZip } from '../buildZip'
import type { WorkerParsedModel } from '../types'

const MINIMAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function makeSyntheticModel(index: number, extraJsonKb = 0) {
  return {
    name: `Stress Model ${index}`,
    format_version: '1.21.0',
    ...(extraJsonKb > 0
      ? { _stress_padding: 'A'.repeat(extraJsonKb * 1024) }
      : {}),
    elements: [{ type: 'cube', uuid: `el-${index}`, name: 'body' }],
    outliner: [{ name: 'root', uuid: `bone-${index}`, children: [`el-${index}`] }],
    textures: [
      {
        uuid: `tex-${index}`,
        name: `skin_${index}`,
        width: 64,
        height: 64,
        source: `data:image/png;base64,${MINIMAL_PNG_BASE64}`,
      },
    ],
    animations: [
      {
        uuid: `anim-${index}`,
        name: `walk_${index}`,
        length: 1,
        loop: true,
        animators: {
          [`bone-${index}`]: {
            rotation: { '0': [{ x: 0 }], '20': [{ x: 45 }] },
          },
        },
      },
    ],
  }
}

function estimateWorkerPayloadJsonSize(result: WorkerParsedModel): number {
  const clone = {
    ...result,
    textures: result.textures.map(({ blobBuffer: _buffer, ...rest }) => rest),
  }
  return JSON.stringify(clone).length
}

function simulateLazyCommit(id: string, rawText: string, assetTextures: ReturnType<typeof workerTexturesToExtracted>) {
  modelDataStore.set(id, {
    rawText,
    geometry: { elements: [], outliner: [] },
    animations: [],
    textures: assetTextures,
  })
}

describe('batchStress', () => {
  beforeEach(() => {
    modelDataStore.clear()
  })

  it('keeps slim worker payload under threshold for 14 sequential models', () => {
    const PAYLOAD_THRESHOLD_BYTES = 50 * 1024

    for (let index = 0; index < 14; index += 1) {
      const raw = makeSyntheticModel(index, index === 9 ? 64 : 1)
      const rawText = JSON.stringify(raw)
      const prepared = prepareWorkerInputFromParsed(raw, `model_${index}.bbmodel`, {
        rawText,
        originalSizeBytes: rawText.length,
      })

      expect(prepared.error).toBeUndefined()

      const workerResult = decodeTexturesInWorker(prepared.input)
      expect(workerResult.status).toBe('done')

      const payloadSize = estimateWorkerPayloadJsonSize(workerResult)
      expect(payloadSize).toBeLessThan(PAYLOAD_THRESHOLD_BYTES)

      expect('geometry' in workerResult).toBe(false)
    }
  })

  it('processes 14 sequential buffers via worker pipeline without main-thread JSON.parse', () => {
    for (let index = 0; index < 14; index += 1) {
      const raw = makeSyntheticModel(index, index === 9 ? 64 : 1)
      const rawText = JSON.stringify(raw)
      const buffer = new TextEncoder().encode(rawText).buffer

      const { result, animationMeta, error } = processModelBuffer(
        buffer,
        `model_${index}.bbmodel`,
        buffer.byteLength,
      )

      expect(error).toBeUndefined()
      expect(result.status).toBe('done')
      expect(animationMeta).toHaveLength(1)
      expect(animationMeta[0].keyframeCount).toBe(0)
      expect(result.summary.totalKeyframes).toBe(0)
      expect(result.textures).toHaveLength(1)
      expect(result.summary.elementCount).toBe(1)
    }
  })

  it('lazy ensureHeavyData fills real keyframe counts after worker batch path', () => {
    const raw = makeSyntheticModel(0, 2)
    const rawText = JSON.stringify(raw)
    const buffer = new TextEncoder().encode(rawText).buffer

    const { result, animationMeta, rawText: decodedText } = processModelBuffer(
      buffer,
      'stress.bbmodel',
      buffer.byteLength,
    )

    expect(result.status).toBe('done')
    expect(animationMeta[0].keyframeCount).toBe(0)
    expect(result.summary.totalKeyframes).toBe(0)

    const heavy = extractHeavyFromRawText(decodedText)
    expect(heavy.animations).toHaveLength(1)
    expect(heavy.animations[0].keyframeCount).toBe(2)
  })

  it('lazy commit stores empty geometry/animations until ensureHeavyData', () => {
    const raw = makeSyntheticModel(0, 2)
    const rawText = JSON.stringify(raw)
    const prepared = prepareWorkerInputFromParsed(raw, 'stress.bbmodel', { rawText })
    const workerResult = decodeTexturesInWorker(prepared.input)
    const hydrated = hydrateWorkerModel(
      workerResult,
      'stress-id',
      rawText.length,
      rawText,
      prepared.animationMeta,
    )

    simulateLazyCommit('stress-id', rawText, hydrated.assetTextures)

    const stored = modelDataStore.get('stress-id')
    expect(stored?.geometry.elements).toHaveLength(0)
    expect(stored?.geometry.outliner).toHaveLength(0)
    expect(stored?.animations).toHaveLength(0)

    const assets = modelDataStore.ensureHeavyData('stress-id')
    expect(assets?.geometry.elements).toHaveLength(1)
    expect(assets?.animations).toHaveLength(1)
    expect(assets!.animations[0].keyframeCount).toBe(2)
    expect(Object.keys(assets!.animations[0].data).length).toBeGreaterThan(0)
    expect(assets?.textures).toHaveLength(1)
  })

  it('round-trips heavy data through ensureHeavyData after lazy commit', () => {
    const raw = makeSyntheticModel(0, 2)
    const rawText = JSON.stringify(raw)
    const prepared = prepareWorkerInputFromParsed(raw, 'stress.bbmodel', { rawText })
    const workerResult = decodeTexturesInWorker(prepared.input)
    const hydrated = hydrateWorkerModel(
      workerResult,
      'stress-id',
      rawText.length,
      rawText,
      prepared.animationMeta,
    )

    simulateLazyCommit('stress-id', rawText, hydrated.assetTextures)

    const assets = modelDataStore.ensureHeavyData('stress-id')
    expect(assets?.geometry.elements).toHaveLength(1)
    expect(assets?.animations).toHaveLength(1)
    expect(assets!.animations[0].keyframeCount).toBe(2)
    expect(Object.keys(assets!.animations[0].data).length).toBeGreaterThan(0)
    expect(assets?.textures).toHaveLength(1)
  })

  it('buildModelZip includes geometry, animations, and textures from asset store', async () => {
    const raw = makeSyntheticModel(1, 1)
    const rawText = JSON.stringify(raw)
    const prepared = prepareWorkerInputFromParsed(raw, 'export.bbmodel', { rawText })
    const workerResult = decodeTexturesInWorker(prepared.input)
    const hydrated = hydrateWorkerModel(
      workerResult,
      'export-id',
      rawText.length,
      rawText,
      prepared.animationMeta,
    )

    simulateLazyCommit('export-id', rawText, hydrated.assetTextures)

    const zipBlob = await buildModelZip(hydrated.model)
    expect(zipBlob.size).toBeGreaterThan(100)

    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer())
    expect(zip.file('Stress_Model_1/geometry/elements.json')).toBeTruthy()
    expect(zip.file('Stress_Model_1/animations/walk_1.json')).toBeTruthy()
    expect(Object.keys(zip.files).some((path) => path.includes('textures/'))).toBe(true)
  })

  it('workerTexturesToExtracted creates preview URLs without geometry clone', () => {
    const raw = makeSyntheticModel(2, 1)
    const rawText = JSON.stringify(raw)
    const workerResult = parseModelFromObject(raw, 'tex.bbmodel', {
      rawText,
      forWorker: true,
    }) as WorkerParsedModel

    const textures = workerTexturesToExtracted(workerResult.textures)
    expect(textures[0].previewUrl).toMatch(/^blob:/)
    expect(textures[0].blob.size).toBeGreaterThan(0)
  })
})
