/**
 * Build a compact analysis payload from a model folder for Gemini labeling.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { loadOptionalJson } from './ragFolderUtils.mjs'

function collectOutlinerNames(nodes, names = [], depth = 0) {
  if (!Array.isArray(nodes) || depth > 12 || names.length >= 80) return names
  for (const node of nodes) {
    if (names.length >= 80) break
    if (typeof node === 'string') {
      names.push(node)
      continue
    }
    if (!node || typeof node !== 'object') continue
    if (typeof node.name === 'string' && node.name.trim()) names.push(node.name)
    if (Array.isArray(node.children)) collectOutlinerNames(node.children, names, depth + 1)
  }
  return names
}

function summarizeElements(elements) {
  if (!Array.isArray(elements)) {
    return { count: 0, cubeCount: 0, types: {}, sampleNames: [] }
  }
  const types = {}
  const sampleNames = []
  let cubeCount = 0
  for (const element of elements) {
    if (!element || typeof element !== 'object') continue
    const type = typeof element.type === 'string' ? element.type : 'cube'
    types[type] = (types[type] ?? 0) + 1
    if (type === 'cube' || type === '') cubeCount += 1
    if (sampleNames.length < 40 && typeof element.name === 'string' && element.name.trim()) {
      sampleNames.push(element.name)
    }
  }
  return { count: elements.length, cubeCount, types, sampleNames }
}

function complexityFromCounts(cubeCount, elementCount) {
  const n = cubeCount > 0 ? cubeCount : elementCount
  if (n <= 24) return 'simple'
  if (n <= 100) return 'medium'
  return 'complex'
}

export function buildModelAnalysis(folderPath) {
  const folderName = basename(folderPath)
  const metadata = loadOptionalJson(join(folderPath, 'metadata.json')) ?? {}
  const summary = loadOptionalJson(join(folderPath, 'summary.json')) ?? {}
  const model = loadOptionalJson(join(folderPath, 'model.json'))
  const elements =
    model?.elements ??
    loadOptionalJson(join(folderPath, 'geometry', 'elements.json')) ??
    []
  const outliner =
    model?.outliner ??
    loadOptionalJson(join(folderPath, 'geometry', 'outliner.json')) ??
    []

  const animationsDir = join(folderPath, 'animations')
  const animationNames = []
  if (existsSync(animationsDir) && statSync(animationsDir).isDirectory()) {
    for (const name of readdirSync(animationsDir)) {
      if (!name.toLowerCase().endsWith('.json')) continue
      if (name.toLowerCase() === 'animations_manifest.json') continue
      try {
        const data = JSON.parse(readFileSync(join(animationsDir, name), 'utf8').replace(/^\uFEFF/, ''))
        animationNames.push(typeof data?.name === 'string' ? data.name : name.replace(/\.json$/i, ''))
      } catch {
        animationNames.push(name.replace(/\.json$/i, ''))
      }
    }
  } else if (Array.isArray(model?.animations)) {
    for (const anim of model.animations) {
      if (anim && typeof anim.name === 'string') animationNames.push(anim.name)
    }
  }

  const textureNames = []
  const texturesDir = join(folderPath, 'textures')
  const manifest = loadOptionalJson(join(texturesDir, 'textures_manifest.json'))
  if (Array.isArray(manifest)) {
    for (const entry of manifest) {
      if (entry && typeof entry.name === 'string') textureNames.push(entry.name)
      else if (entry && typeof entry.filename === 'string') textureNames.push(entry.filename)
    }
  } else if (existsSync(texturesDir) && statSync(texturesDir).isDirectory()) {
    for (const name of readdirSync(texturesDir)) {
      if (/\.(png|jpe?g|webp)$/i.test(name)) textureNames.push(name)
    }
  }

  const elementSummary = summarizeElements(elements)
  const boneNames = collectOutlinerNames(outliner)

  return {
    folder_name: folderName,
    display_name: metadata.name ?? model?.name ?? folderName,
    model_format: metadata.model_format ?? model?.model_format ?? model?.meta?.model_format ?? null,
    resolution: metadata.resolution ?? model?.resolution ?? null,
    summary,
    element_count: elementSummary.count,
    cube_count: elementSummary.cubeCount,
    suggested_complexity: complexityFromCounts(elementSummary.cubeCount, elementSummary.count),
    element_types: elementSummary.types,
    sample_element_names: elementSummary.sampleNames,
    bone_names: boneNames,
    animation_names: animationNames,
    texture_names: textureNames,
    has_animation: animationNames.length > 0 || (summary.animationCount ?? 0) > 0,
    has_metadata: existsSync(join(folderPath, 'metadata.json')),
  }
}

export function findPreviewTexture(folderPath) {
  const texturesDir = join(folderPath, 'textures')
  if (!existsSync(texturesDir) || !statSync(texturesDir).isDirectory()) return null

  const preferred = []
  const others = []
  for (const name of readdirSync(texturesDir)) {
    const ext = extname(name).toLowerCase()
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) continue
    const full = join(texturesDir, name)
    const size = statSync(full).size
    if (size <= 0 || size > 4_000_000) continue
    const entry = { path: full, name, mimeType: ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg' }
    if (/skin|body|alex|steve|player|main/i.test(name)) preferred.push(entry)
    else others.push(entry)
  }
  return preferred[0] ?? others[0] ?? null
}
