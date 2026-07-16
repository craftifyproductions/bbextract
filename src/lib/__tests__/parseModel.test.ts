import { describe, expect, it } from 'vitest'
import { performance } from 'node:perf_hooks'
import { decodeTexture } from '../decodeTexture'
import {
  estimateJsonSize,
  hydrateWorkerModel,
  parseModel,
  prepareWorkerInputFromParsed,
  decodeTexturesInWorker,
} from '../parseModel'
import { makeUniqueFilename } from '../sanitize'
import { countAnimationKeyframes, countBones, countElements } from '../stats'
import type { WorkerParsedModel } from '../types'

const MINIMAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('decodeTexture', () => {
  it('decodes data URI base64 to blob', () => {
    const blob = decodeTexture(`data:image/png;base64,${MINIMAL_PNG_BASE64}`)
    expect(blob).not.toBeNull()
    expect(blob?.type).toBe('image/png')
    expect(blob?.size).toBeGreaterThan(0)
  })

  it('returns null for invalid source', () => {
    expect(decodeTexture('not-valid')).toBeNull()
    expect(decodeTexture('')).toBeNull()
  })
})

describe('stats', () => {
  it('counts bones recursively in outliner', () => {
    const outliner = [
      {
        name: 'root',
        uuid: 'bone-1',
        children: [
          'element-ref',
          { name: 'arm', uuid: 'bone-2', children: [] },
        ],
      },
    ]
    expect(countBones(outliner)).toBe(2)
  })

  it('counts mesh elements separately', () => {
    const elements = [
      { type: 'cube', uuid: 'c1' },
      { type: 'mesh', uuid: 'm1' },
      { type: 'cube', uuid: 'c2' },
    ]
    expect(countElements(elements)).toEqual({ total: 3, cubes: 2, meshes: 1 })
  })

  it('counts keyframes for format A and B animators', () => {
    const formatA = {
      'bone-1': {
        keyframes: [{ channel: 'rotation', time: 0, data_points: [] }],
      },
    }
    const formatB = {
      'bone-2': {
        rotation: { '0': [{ x: 0 }], '10': [{ x: 90 }] },
        position: { '0': [{ x: 0 }] },
      },
    }
    expect(countAnimationKeyframes(formatA)).toBe(1)
    expect(countAnimationKeyframes(formatB)).toBe(3)
  })
})

describe('estimateJsonSize', () => {
  it('estimates size without JSON.stringify', () => {
    const value = {
      name: 'Test',
      count: 3,
      tags: ['a', 'b'],
      nested: { enabled: true },
    }
    const estimate = estimateJsonSize(value)
    const actual = new Blob([JSON.stringify(value)]).size
    expect(estimate).toBeGreaterThan(0)
    expect(Math.abs(estimate - actual)).toBeLessThan(actual * 0.2)
  })
})

describe('parseModel', () => {
  const minimalRaw = {
    name: 'Test Model',
    format_version: '1.21.0',
    model_format: 'free',
    resolution: { width: 64, height: 64 },
    elements: [{ type: 'cube', uuid: 'el-1', name: 'body' }],
    outliner: [{ name: 'root', uuid: 'bone-1', children: ['el-1'] }],
    textures: [
      {
        uuid: 'tex-1',
        name: 'skin',
        id: 0,
        width: 64,
        height: 64,
        source: `data:image/png;base64,${MINIMAL_PNG_BASE64}`,
      },
    ],
    animations: [
      {
        uuid: 'anim-1',
        name: 'walk',
        length: 1,
        loop: true,
        animators: {
          'bone-1': {
            rotation: { '0': [{ x: 0 }], '20': [{ x: 45 }] },
          },
        },
      },
    ],
  }

  it('parses a minimal valid bbmodel', () => {
    const model = parseModel(minimalRaw, 'test.bbmodel')
    expect(model.status).toBe('done')
    expect(model.folderName).toBe('Test_Model')
    expect(model.textures).toHaveLength(1)
    expect(model.animations).toHaveLength(1)
    expect(model.summary.boneCount).toBe(1)
    expect(model.summary.meshCount).toBe(0)
    expect(model.summary.totalKeyframes).toBe(2)
    expect(model.rawText).toBeTruthy()
    expect(model.extractedSizeBytes).toBeGreaterThan(0)
  })

  it('dedupes textures by uuid', () => {
    const raw = {
      name: 'Dupes',
      elements: [],
      outliner: [],
      textures: [
        {
          uuid: 'same-uuid',
          name: 'a',
          source: `data:image/png;base64,${MINIMAL_PNG_BASE64}`,
        },
        {
          uuid: 'same-uuid',
          name: 'b',
          source: `data:image/png;base64,${MINIMAL_PNG_BASE64}`,
        },
      ],
    }

    const model = parseModel(raw, 'dupes.bbmodel')
    expect(model.textures).toHaveLength(1)
  })

  it('returns error for non-object input', () => {
    const model = parseModel(null, 'bad.bbmodel')
    expect(model.status).toBe('error')
    expect(model.error).toBeTruthy()
  })

  it('handles missing arrays gracefully', () => {
    const model = parseModel({ name: 'Empty' }, 'empty.bbmodel')
    expect(model.status).toBe('done')
    expect(model.geometry.elements).toEqual([])
    expect(model.summary.warnings?.length).toBeGreaterThan(0)
  })

  it('uses arithmetic extracted size instead of multiple stringifies', () => {
    const model = parseModel(minimalRaw, 'test.bbmodel')
    expect(model.extractedSizeBytes).toBeGreaterThan(0)
  })
})

describe('makeUniqueFilename', () => {
  it('uniquifies dotted Blockbench animation names without infinite loops', () => {
    const used = new Set<string>()
    const idle = makeUniqueFilename('animation.sunman.idle', 'json', used, '16ef15b8-0000')
    const walk = makeUniqueFilename('animation.sunman.walk', 'json', used, '0d5a8810-0000')
    const attack = makeUniqueFilename('animation.sunman.attack', 'json', used, 'be6cf0f9-0000')

    expect(idle).toBe('animation.sunman.idle.json')
    expect(walk).toBe('animation.sunman.walk.json')
    expect(attack).toBe('animation.sunman.attack.json')
    expect(new Set([idle, walk, attack]).size).toBe(3)
  })
})

describe('prepareWorkerInputFromParsed', () => {
  it('completes quickly for GeckoLib plugin fields and groups alongside outliner', () => {
    const raw = {
      name: 'regular_sunman',
      bedrock_animation_mode: true,
      geckolib_modid: 'examplemod',
      groups: [{ uuid: 'g1', name: 'root', children: [] }],
      multi_file_ruleset: {},
      variable_placeholders: [],
      variable_placeholder_buttons: [],
      timeline_setups: [],
      unhandled_root_fields: ['groups'],
      elements: [{ type: 'cube', uuid: 'el-1' }],
      outliner: [{ name: 'root', uuid: 'bone-1', children: ['el-1'] }],
      textures: [],
      animations: [
        { uuid: '16ef15b8-1111', name: 'animation.sunman.idle', length: 1, loop: true },
        { uuid: '0d5a8810-2222', name: 'animation.sunman.walk', length: 1, loop: true },
        { uuid: 'be6cf0f9-3333', name: 'animation.sunman.attack', length: 1, loop: true },
      ],
    }
    const rawText = JSON.stringify(raw)
    const t0 = performance.now()
    const prepared = prepareWorkerInputFromParsed(raw, 'regular_sunman.bbmodel', { rawText })
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(prepared.error).toBeUndefined()
    expect(prepared.animationMeta).toHaveLength(3)
    expect(new Set(prepared.animationMeta.map((anim) => anim.filename)).size).toBe(3)
  })
})

describe('hydrateWorkerModel', () => {
  it('creates blobs and preview URLs from worker texture buffers', async () => {
    const blob = decodeTexture(`data:image/png;base64,${MINIMAL_PNG_BASE64}`)
    expect(blob).not.toBeNull()

    const arrayBuffer = await blob!.arrayBuffer()
    const workerResult: WorkerParsedModel = {
      folderName: 'Test_Model',
      originalFilename: 'test.bbmodel',
      originalSizeBytes: 1000,
      extractedSizeBytes: 500,
      metadata: { name: 'Test Model' },
      textures: [
        {
          uuid: 'tex-1',
          name: 'skin',
          width: 64,
          height: 64,
          filename: 'skin.png',
          blobBuffer: arrayBuffer,
          mime: 'image/png',
        },
      ],
      summary: {
        elementCount: 0,
        cubeCount: 0,
        meshCount: 0,
        boneCount: 0,
        textureCount: 1,
        animationCount: 0,
        totalKeyframes: 0,
        originalFilename: 'test.bbmodel',
        extractedAt: new Date().toISOString(),
      },
      status: 'done',
    }

    const rawText = '{"name":"Test Model"}'
    const { model, assetTextures } = hydrateWorkerModel(workerResult, 'model-id', 1000, rawText)
    expect(model.id).toBe('model-id')
    expect(model.textures).toHaveLength(1)
    expect(assetTextures).toHaveLength(1)
    expect(assetTextures[0].blob.size).toBeGreaterThan(0)
    expect(assetTextures[0].previewUrl).toMatch(/^blob:/)
  })

  it('parses worker output via prepareWorkerInput + decodeTexturesInWorker', async () => {
    const raw = {
      name: 'Worker Model',
      elements: [],
      outliner: [],
      textures: [
        {
          uuid: 'tex-1',
          name: 'skin',
          source: `data:image/png;base64,${MINIMAL_PNG_BASE64}`,
        },
      ],
    }
    const rawText = JSON.stringify(raw)
    const prepared = prepareWorkerInputFromParsed(raw, 'worker.bbmodel', { rawText })
    const workerResult = decodeTexturesInWorker(prepared.input)

    expect(workerResult.status).toBe('done')
    expect(workerResult.textures[0].blobBuffer.byteLength).toBeGreaterThan(0)
    expect('rawText' in workerResult).toBe(false)
    expect('geometry' in workerResult).toBe(false)

    const { model, assetTextures } = hydrateWorkerModel(
      workerResult,
      'worker-id',
      rawText.length,
      rawText,
      prepared.animationMeta,
    )
    expect(model.status).toBe('done')
    expect(assetTextures[0].previewUrl).toMatch(/^blob:/)
    expect(model.rawText).toBe(rawText)
  })
})
