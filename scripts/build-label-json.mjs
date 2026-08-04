#!/usr/bin/env node
/**
 * Create draft label.json for BBExtract-extracted model folders.
 *
 * Usage:
 *   node scripts/build-label-json.mjs <model-folder-or-parent> [--force]
 *
 * Writes searchable metadata used later by the RAG backfill step.
 * Review/edit description, embedding_text, category, and tags before indexing.
 */
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  guessCategory,
  humanizeFolderName,
  listJsonFiles,
  loadOptionalJson,
  parseArgs,
  resolveModelFolders,
  uniqueStrings,
  writeJson,
} from './lib/ragFolderUtils.mjs'

const { force, targetPath } = parseArgs(process.argv)

console.log(`Target: ${targetPath}`)

if (!targetPath) {
  console.error('Usage: node scripts/build-label-json.mjs [model-folder-or-parent] [--force]')
  process.exit(1)
}

function countAnimations(folderPath, summary) {
  if (typeof summary?.animationCount === 'number') return summary.animationCount
  const animationsDir = join(folderPath, 'animations')
  return listJsonFiles(animationsDir, { exclude: ['animations_manifest.json'] }).length
}

function countTextures(folderPath, summary) {
  if (typeof summary?.textureCount === 'number') return summary.textureCount
  const manifest = loadOptionalJson(join(folderPath, 'textures', 'textures_manifest.json'))
  return Array.isArray(manifest) ? manifest.length : 0
}

function guessStyleTags({ summary, modelFormat, boxUv }) {
  const tags = ['blockbench']
  if (modelFormat) tags.push(String(modelFormat))
  if (boxUv) tags.push('box-uv')
  if ((summary?.cubeCount ?? 0) > 0 && (summary?.meshCount ?? 0) === 0) {
    tags.push('cubes')
  }
  if ((summary?.meshCount ?? 0) > 0) tags.push('mesh')
  if ((summary?.boneCount ?? 0) > 0) tags.push('rigged')
  if ((summary?.elementCount ?? 0) > 0 && (summary?.elementCount ?? 0) <= 20) {
    tags.push('low-poly')
  }
  return uniqueStrings(tags)
}

function guessMaterialTags(text) {
  const hay = text.toLowerCase()
  const catalog = [
    'wood',
    'metal',
    'stone',
    'cloth',
    'fabric',
    'leather',
    'fur',
    'glass',
    'crystal',
    'plastic',
    'bone',
    'gold',
    'iron',
    'copper',
    'slime',
    'water',
    'fire',
  ]
  return catalog.filter((material) => hay.includes(material))
}

function guessSubcategory(category, text) {
  const hay = text.toLowerCase()
  if (category === 'creature') {
    if (/(bird|wing|fly)/.test(hay)) return 'flying'
    if (/(fish|aquatic|swim)/.test(hay)) return 'aquatic'
    if (/(quad|fox|wolf|dog|cat|horse)/.test(hay)) return 'quadruped'
    return 'creature'
  }
  if (category === 'character') {
    if (/(armor|knight|soldier|warrior)/.test(hay)) return 'armored'
    if (/(mage|wizard|witch)/.test(hay)) return 'caster'
    return 'humanoid'
  }
  if (category === 'prop') {
    if (/(sword|axe|bow|weapon)/.test(hay)) return 'weapon'
    if (/(chair|table|furniture)/.test(hay)) return 'furniture'
    if (/(chest|crate|box)/.test(hay)) return 'container'
    return 'object'
  }
  if (category === 'environment') {
    if (/(tree|bush|plant)/.test(hay)) return 'foliage'
    if (/(house|building|castle)/.test(hay)) return 'structure'
    return 'terrain'
  }
  return undefined
}

function buildLabel(folderPath) {
  const folderName = basename(folderPath)
  const metadata = loadOptionalJson(join(folderPath, 'metadata.json')) ?? {}
  const summary = loadOptionalJson(join(folderPath, 'summary.json')) ?? {}

  const displayName =
    (typeof metadata.name === 'string' && metadata.name.trim()) ||
    humanizeFolderName(folderName)

  const animationCount = countAnimations(folderPath, summary)
  const textureCount = countTextures(folderPath, summary)
  const elementCount = typeof summary.elementCount === 'number' ? summary.elementCount : null
  const boneCount = typeof summary.boneCount === 'number' ? summary.boneCount : null

  const statsBits = []
  if (elementCount != null) statsBits.push(`${elementCount} elements`)
  if (boneCount != null) statsBits.push(`${boneCount} bones`)
  if (textureCount > 0) statsBits.push(`${textureCount} textures`)
  if (animationCount > 0) statsBits.push(`${animationCount} animations`)

  const description = [
    `Blockbench model "${displayName}"`,
    statsBits.length > 0 ? `with ${statsBits.join(', ')}` : null,
    metadata.model_format ? `(format: ${metadata.model_format})` : null,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  const searchCorpus = [
    displayName,
    folderName,
    metadata.model_format,
    metadata.model_identifier,
    summary.originalFilename,
  ]
    .filter(Boolean)
    .join(' ')

  const category = guessCategory(searchCorpus)
  const subcategory = guessSubcategory(category, searchCorpus)
  const styleTags = guessStyleTags({
    summary,
    modelFormat: metadata.model_format,
    boxUv: metadata.box_uv,
  })
  const materialTags = guessMaterialTags(searchCorpus)

  const embeddingParts = uniqueStrings([
    displayName,
    category,
    subcategory,
    ...styleTags,
    ...materialTags,
    animationCount > 0 ? 'animated' : 'static',
    elementCount != null ? `${elementCount} elements` : '',
    boneCount != null ? `${boneCount} bones` : '',
    'blockbench model game asset',
  ])

  return {
    description,
    embedding_text: embeddingParts.join(' '),
    category,
    ...(subcategory ? { subcategory } : {}),
    style_tags: styleTags,
    material_tags: materialTags,
    has_animation: animationCount > 0,
    has_metadata: existsSync(join(folderPath, 'metadata.json')),
    _draft: true,
    _source_folder: folderName,
    _notes:
      'Auto-generated draft. Edit description, embedding_text, category, and tags before RAG backfill.',
  }
}

function processFolder(folderPath) {
  const outPath = join(folderPath, 'label.json')
  if (existsSync(outPath) && !force) {
    return { status: 'skipped', reason: 'label.json exists (use --force to overwrite)' }
  }

  const label = buildLabel(folderPath)
  writeJson(outPath, label)
  return {
    status: 'written',
    category: label.category,
    hasAnimation: label.has_animation,
  }
}

const folders = resolveModelFolders(targetPath)
let written = 0
let skipped = 0
let failed = 0

console.log(`Building label.json for ${folders.length} folder(s)...\n`)

for (const folderPath of folders) {
  const name = basename(folderPath)
  try {
    const result = processFolder(folderPath)
    if (result.status === 'written') {
      written += 1
      console.log(
        `✓ ${name} — category=${result.category} animated=${result.hasAnimation}`,
      )
    } else {
      skipped += 1
      console.log(`· ${name} — skipped: ${result.reason}`)
    }
  } catch (error) {
    failed += 1
    const message = error instanceof Error ? error.message : String(error)
    console.error(`✗ ${name} — ${message}`)
  }
}

console.log(`\nDone. written=${written} skipped=${skipped} failed=${failed}`)
console.log('Tip: open label.json files and improve embedding_text / category before backfill.')
if (failed > 0) process.exit(1)
