import { describe, expect, it } from 'vitest'
import { buildGroupedAssetLocation, resolveModelFolderForAsset } from '../modelAssetGrouping'
import type { DirectUploadAssetItem, ProcessedModel } from './types'

function model(partial: Partial<ProcessedModel> & Pick<ProcessedModel, 'folderName' | 'originalFilename'>): ProcessedModel {
  return {
    id: '1',
    originalSizeBytes: 1,
    extractedSizeBytes: 1,
    metadata: { name: partial.folderName },
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
      originalFilename: partial.originalFilename,
      extractedAt: new Date().toISOString(),
    },
    status: 'done',
    ...partial,
  }
}

function asset(partial: Partial<DirectUploadAssetItem> & Pick<DirectUploadAssetItem, 'file'>): DirectUploadAssetItem {
  return {
    kind: 'asset',
    assetKind: 'texture',
    sourceArchive: 'pack.zip',
    ...partial,
  }
}

describe('modelAssetGrouping', () => {
  it('groups sidecar files under the matching model folder', () => {
    const models = [
      model({
        folderName: 'Pack__cow',
        originalFilename: 'Pack__cow.bbmodel',
        sourceArchive: 'pack.zip',
        originalPath: 'models/cow.bbmodel',
      }),
    ]

    const texture = asset({
      assetKind: 'texture',
      file: new File(['x'], 'Pack__cow.png', { type: 'image/png' }),
      originalPath: 'textures/cow.png',
    })

    expect(resolveModelFolderForAsset(texture, models)).toBe('Pack__cow')
    expect(buildGroupedAssetLocation('run', texture, models).storagePath).toBe(
      'run/pack/Pack__cow/texture/Pack__cow.png',
    )
  })

  it('puts unmatched assets under _unassigned', () => {
    const texture = asset({
      file: new File(['x'], 'Pack__orphan.png', { type: 'image/png' }),
    })

    expect(buildGroupedAssetLocation('run', texture, []).storagePath).toBe(
      'run/pack/_unassigned/texture/Pack__orphan.png',
    )
  })
})
