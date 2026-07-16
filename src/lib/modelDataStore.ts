import { extractHeavyFromRawText } from './extractHeavyFromRawText'
import type { ExtractedAnimation, ExtractedTexture, ModelHeavyData } from './types'

const store = new Map<string, ModelHeavyData>()

function revokeTextureUrls(textures: ExtractedTexture[]): void {
  for (const texture of textures) {
    if (texture.previewUrl) {
      URL.revokeObjectURL(texture.previewUrl)
    }
  }
}

export const modelDataStore = {
  set(id: string, data: ModelHeavyData): void {
    const existing = store.get(id)
    if (existing && existing !== data) {
      revokeTextureUrls(existing.textures)
    }
    store.set(id, data)
  },

  get(id: string): ModelHeavyData | undefined {
    return store.get(id)
  },

  getTextures(id: string): ExtractedTexture[] {
    return store.get(id)?.textures ?? []
  },

  getThumbnailUrl(id: string): string | undefined {
    return store.get(id)?.textures[0]?.previewUrl
  },

  ensureHeavyData(id: string, rawText?: string): ModelHeavyData | undefined {
    const existing = store.get(id)
    const text = rawText ?? existing?.rawText
    if (!text) return existing

    const hasGeometry =
      (existing?.geometry.elements.length ?? 0) > 0 ||
      (existing?.geometry.outliner.length ?? 0) > 0
    const hasAnimationData =
      existing?.animations.some(
        (animation: ExtractedAnimation) => Object.keys(animation.data).length > 0,
      ) ?? false

    if (existing && hasGeometry && (existing.animations.length === 0 || hasAnimationData)) {
      return existing
    }

    const extracted = extractHeavyFromRawText(text)
    const merged: ModelHeavyData = {
      rawText: text,
      geometry: extracted.geometry,
      animations: extracted.animations,
      textures: existing?.textures ?? [],
    }
    store.set(id, merged)
    return merged
  },

  remove(id: string): void {
    const entry = store.get(id)
    if (entry) revokeTextureUrls(entry.textures)
    store.delete(id)
  },

  clear(): void {
    for (const entry of store.values()) {
      revokeTextureUrls(entry.textures)
    }
    store.clear()
  },

  count(): number {
    return store.size
  },

  totalRawTextBytes(): number {
    let total = 0
    for (const entry of store.values()) {
      total += entry.rawText.length
    }
    return total
  },
}

export type { ModelHeavyData }
