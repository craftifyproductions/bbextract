import { extractGeometryAndAnimationsFromParsed } from './parseModel'
import type { ModelHeavyData } from './types'

const EMPTY_GEOMETRY: ModelHeavyData['geometry'] = { elements: [], outliner: [] }

export function extractHeavyFromRawText(
  rawText: string,
): Omit<ModelHeavyData, 'textures'> {
  if (!rawText) {
    return { rawText: '', geometry: EMPTY_GEOMETRY, animations: [] }
  }

  try {
    const parsed = JSON.parse(rawText) as unknown
    const { geometry, animations } = extractGeometryAndAnimationsFromParsed(parsed)
    return { rawText, geometry, animations }
  } catch {
    return { rawText, geometry: EMPTY_GEOMETRY, animations: [] }
  }
}
