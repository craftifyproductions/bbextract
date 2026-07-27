import type { AggregateStats, ProcessedModel } from './types'

export function countBones(outliner: unknown[]): number {
  let count = 0
  const visited = new Set<unknown>()
  const maxDepth = 512

  function walk(nodes: unknown[], depth: number) {
    if (depth > maxDepth) return
    for (const node of nodes) {
      if (typeof node === 'string') continue
      if (!node || typeof node !== 'object') continue
      if (visited.has(node)) continue
      visited.add(node)

      const obj = node as Record<string, unknown>
      if (Array.isArray(obj.children)) {
        count++
        walk(obj.children, depth + 1)
      }
    }
  }

  walk(outliner, 0)
  return count
}

export function countElements(elements: unknown[]): {
  total: number
  cubes: number
  meshes: number
} {
  let cubes = 0
  let meshes = 0

  for (const element of elements) {
    if (!element || typeof element !== 'object') continue
    const type = (element as Record<string, unknown>).type
    if (type === 'mesh') meshes++
    else cubes++
  }

  return { total: elements.length, cubes, meshes }
}

export function countAnimationKeyframes(animators: unknown): number {
  if (!animators || typeof animators !== 'object') return 0

  let total = 0
  const animatorMap = animators as Record<string, unknown>

  for (const boneUuid of Object.keys(animatorMap)) {
    const animator = animatorMap[boneUuid]
    if (!animator || typeof animator !== 'object') continue

    const anim = animator as Record<string, unknown>

    if (Array.isArray(anim.keyframes)) {
      total += anim.keyframes.length
      continue
    }

    for (const key of Object.keys(anim)) {
      if (key === 'name' || key === 'type') continue
      const channel = anim[key]
      if (channel && typeof channel === 'object' && !Array.isArray(channel)) {
        total += Object.keys(channel as Record<string, unknown>).length
      }
    }
  }

  return total
}

export function computeAggregateStats(models: ProcessedModel[]): AggregateStats {
  const doneModels = models.filter((model) => model.status === 'done')

  return {
    modelCount: doneModels.length,
    textureCount: doneModels.reduce((sum, model) => sum + model.textures.length, 0),
    animationCount: doneModels.reduce((sum, model) => sum + model.animations.length, 0),
    elementCount: doneModels.reduce((sum, model) => sum + model.summary.elementCount, 0),
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatStorageCompact(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) return formatBytes(bytes)
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
