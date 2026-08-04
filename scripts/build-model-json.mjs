#!/usr/bin/env node
/**
 * Rebuild model.json for BBExtract-extracted model folders.
 *
 * Usage:
 *   node scripts/build-model-json.mjs <model-folder-or-parent> [--force]
 *
 * Priority:
 *   1) Existing .bbmodel in the folder (copied as model.json)
 *   2) Rebuild from metadata.json + geometry/ + animations/ + textures manifest
 */
import { copyFileSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  findBbmodelFile,
  listJsonFiles,
  loadOptionalJson,
  parseArgs,
  resolveModelFolders,
  writeJson,
} from './lib/ragFolderUtils.mjs'

const { force, targetPath } = parseArgs(process.argv)

console.log(`Target: ${targetPath}`)

if (!targetPath) {
  console.error('Usage: node scripts/build-model-json.mjs [model-folder-or-parent] [--force]')
  process.exit(1)
}

function buildTextureEntries(folderPath, metadata) {
  const manifestPath = join(folderPath, 'textures', 'textures_manifest.json')
  const manifest = loadOptionalJson(manifestPath)
  if (!Array.isArray(manifest)) return []

  return manifest.map((entry, index) => {
    const row = entry && typeof entry === 'object' ? entry : {}
    const filename = typeof row.filename === 'string' ? row.filename : null
    return {
      uuid: typeof row.uuid === 'string' ? row.uuid : undefined,
      name:
        typeof row.name === 'string' && row.name.trim()
          ? row.name
          : `texture_${index}`,
      id: row.id,
      width: typeof row.width === 'number' ? row.width : metadata?.resolution?.width,
      height: typeof row.height === 'number' ? row.height : metadata?.resolution?.height,
      ...(filename ? { path: `textures/${filename}` } : {}),
    }
  })
}

function buildAnimationEntries(folderPath) {
  const animationsDir = join(folderPath, 'animations')
  const files = listJsonFiles(animationsDir, {
    exclude: ['animations_manifest.json'],
  })

  const animations = []
  for (const filePath of files) {
    const data = loadOptionalJson(filePath)
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      animations.push(data)
    }
  }
  return animations
}

function rebuildModelJson(folderPath) {
  const metadata = loadOptionalJson(join(folderPath, 'metadata.json')) ?? {}
  const elements =
    loadOptionalJson(join(folderPath, 'geometry', 'elements.json')) ?? []
  const outliner =
    loadOptionalJson(join(folderPath, 'geometry', 'outliner.json')) ?? []

  if (!Array.isArray(elements) || !Array.isArray(outliner)) {
    throw new Error('geometry/elements.json and geometry/outliner.json must be JSON arrays')
  }

  const folderName = basename(folderPath)
  const textures = buildTextureEntries(folderPath, metadata)
  const animations = buildAnimationEntries(folderPath)

  /** @type {Record<string, unknown>} */
  const model = {
    meta: {
      format_version: '4.10',
      model_format: metadata.model_format ?? 'free',
      box_uv: metadata.box_uv ?? false,
    },
    name: metadata.name ?? folderName,
    elements,
    outliner,
  }

  if (metadata.model_identifier != null) model.model_identifier = metadata.model_identifier
  if (metadata.format_version != null) model.format_version = metadata.format_version
  if (metadata.model_format != null) model.model_format = metadata.model_format
  if (typeof metadata.box_uv === 'boolean') model.box_uv = metadata.box_uv
  if (metadata.resolution != null) model.resolution = metadata.resolution
  if (metadata.visible_box != null) model.visible_box = metadata.visible_box
  if (metadata.uuid != null) model.uuid = metadata.uuid
  if (textures.length > 0) model.textures = textures
  if (animations.length > 0) model.animations = animations

  return model
}

function processFolder(folderPath) {
  const outPath = join(folderPath, 'model.json')
  if (existsSync(outPath) && !force) {
    return { status: 'skipped', reason: 'model.json exists (use --force to overwrite)' }
  }

  const bbmodelPath = findBbmodelFile(folderPath)
  if (bbmodelPath) {
    // Prefer the original Blockbench file when present.
    copyFileSync(bbmodelPath, outPath)
    return {
      status: 'written',
      source: `copied ${basename(bbmodelPath)}`,
    }
  }

  const hasGeometry =
    existsSync(join(folderPath, 'geometry', 'elements.json')) ||
    existsSync(join(folderPath, 'geometry', 'outliner.json'))
  const hasMetadata = existsSync(join(folderPath, 'metadata.json'))

  if (!hasGeometry && !hasMetadata) {
    return {
      status: 'error',
      reason: 'no .bbmodel and no metadata/geometry to rebuild from',
    }
  }

  const model = rebuildModelJson(folderPath)
  writeJson(outPath, model)
  return {
    status: 'written',
    source: 'rebuilt from extract files',
    elements: Array.isArray(model.elements) ? model.elements.length : 0,
    animations: Array.isArray(model.animations) ? model.animations.length : 0,
  }
}

const folders = resolveModelFolders(targetPath)
let written = 0
let skipped = 0
let failed = 0

console.log(`Building model.json for ${folders.length} folder(s)...\n`)

for (const folderPath of folders) {
  const name = basename(folderPath)
  try {
    const result = processFolder(folderPath)
    if (result.status === 'written') {
      written += 1
      const extra =
        result.elements != null
          ? ` (${result.elements} elements, ${result.animations ?? 0} animations)`
          : ''
      console.log(`✓ ${name} — ${result.source}${extra}`)
    } else if (result.status === 'skipped') {
      skipped += 1
      console.log(`· ${name} — skipped: ${result.reason}`)
    } else {
      failed += 1
      console.error(`✗ ${name} — ${result.reason}`)
    }
  } catch (error) {
    failed += 1
    const message = error instanceof Error ? error.message : String(error)
    console.error(`✗ ${name} — ${message}`)
  }
}

console.log(`\nDone. written=${written} skipped=${skipped} failed=${failed}`)
if (failed > 0) process.exit(1)
