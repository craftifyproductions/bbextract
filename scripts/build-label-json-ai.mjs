#!/usr/bin/env node
/**
 * AI label.json generator using Gemini 3.1 Flash-Lite.
 *
 * Usage:
 *   node scripts/build-label-json-ai.mjs <model-folder-or-parent> [--force]
 *
 * Requires GEMINI_API_KEY in .env (project root).
 * Optional: GEMINI_LABEL_MODEL=gemini-3.1-flash-lite
 */
import { config as loadEnv } from 'dotenv'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GoogleGenAI } from '@google/genai'
import { buildModelAnalysis, findPreviewTexture } from './lib/modelAnalysis.mjs'
import {
  CATEGORIES,
  parseArgs,
  resolveModelFolders,
  writeJson,
} from './lib/ragFolderUtils.mjs'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
loadEnv({ path: join(rootDir, '.env') })

const LABEL_MODEL = process.env.GEMINI_LABEL_MODEL?.trim() || 'gemini-3.1-flash-lite'
const API_KEY = process.env.GEMINI_API_KEY?.trim()
const LABEL_SCHEMA_VERSION = 2
const COMPLEXITIES = ['simple', 'medium', 'complex']
const CONFIDENCE_LEVELS = ['low', 'medium', 'high']

const { force, targetPath } = parseArgs(process.argv)

console.log(`Target: ${targetPath}`)

if (!targetPath) {
  console.error('Usage: node scripts/build-label-json-ai.mjs [model-folder-or-parent] [--force]')
  process.exit(1)
}

if (!API_KEY) {
  console.error('Missing GEMINI_API_KEY in .env')
  process.exit(1)
}

const LABEL_SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    embedding_text: { type: 'string' },
    category: { type: 'string', enum: CATEGORIES },
    subcategory: { type: 'string' },
    style_tags: { type: 'array', items: { type: 'string' } },
    material_tags: { type: 'array', items: { type: 'string' } },
    color_palette: { type: 'array', items: { type: 'string' } },
    complexity: { type: 'string', enum: COMPLEXITIES },
    confidence: { type: 'string', enum: CONFIDENCE_LEVELS },
    needs_review: { type: 'boolean' },
    has_animation: { type: 'boolean' },
    has_metadata: { type: 'boolean' },
  },
  required: [
    'description',
    'embedding_text',
    'category',
    'style_tags',
    'material_tags',
    'color_palette',
    'complexity',
    'confidence',
    'needs_review',
    'has_animation',
    'has_metadata',
  ],
}

function extractJsonObject(text) {
  const cleaned = text.replace(/```json|```/g, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1))
    }
    throw new Error('Model did not return valid JSON')
  }
}

function complexityFromCounts(cubeCount, elementCount) {
  const n = cubeCount > 0 ? cubeCount : elementCount
  if (n <= 24) return 'simple'
  if (n <= 100) return 'medium'
  return 'complex'
}

function normalizeLabel(raw, analysis) {
  const category = CATEGORIES.includes(raw.category) ? raw.category : 'prop'
  const styleTags = Array.isArray(raw.style_tags)
    ? raw.style_tags.map(String).filter(Boolean).slice(0, 12)
    : []
  const materialTags = Array.isArray(raw.material_tags)
    ? raw.material_tags.map(String).filter(Boolean).slice(0, 8)
    : []
  const colorPalette = Array.isArray(raw.color_palette)
    ? raw.color_palette.map(String).map((c) => c.trim().toLowerCase()).filter(Boolean).slice(0, 8)
    : []

  const cubeCount =
    typeof analysis.cube_count === 'number'
      ? analysis.cube_count
      : typeof analysis.element_count === 'number'
        ? analysis.element_count
        : 0
  const elementCount = typeof analysis.element_count === 'number' ? analysis.element_count : cubeCount
  const complexity = COMPLEXITIES.includes(raw.complexity)
    ? raw.complexity
    : complexityFromCounts(cubeCount, elementCount)
  const confidence = CONFIDENCE_LEVELS.includes(raw.confidence) ? raw.confidence : 'medium'
  const needsReview = typeof raw.needs_review === 'boolean' ? raw.needs_review : confidence === 'low'

  return {
    description: String(raw.description || '').trim() || `Blockbench model "${analysis.display_name}"`,
    embedding_text:
      String(raw.embedding_text || '').trim() ||
      `${analysis.display_name} ${category} blockbench model`,
    category,
    ...(raw.subcategory ? { subcategory: String(raw.subcategory).trim() } : {}),
    style_tags: styleTags.length > 0 ? styleTags : ['blockbench'],
    material_tags: materialTags,
    color_palette: colorPalette,
    complexity,
    cube_count: cubeCount,
    confidence,
    needs_review: needsReview,
    has_animation: Boolean(raw.has_animation ?? analysis.has_animation),
    has_metadata: Boolean(raw.has_metadata ?? analysis.has_metadata),
    label_schema_version: LABEL_SCHEMA_VERSION,
    _draft: false,
    _source: 'gemini',
    _model: LABEL_MODEL,
    _source_folder: analysis.folder_name,
    _labeled_at: new Date().toISOString(),
  }
}

async function labelFolder(ai, folderPath) {
  const outPath = join(folderPath, 'label.json')
  if (existsSync(outPath) && !force) {
    return { status: 'skipped', reason: 'label.json exists (use --force to overwrite)' }
  }

  const analysis = buildModelAnalysis(folderPath)
  const preview = findPreviewTexture(folderPath)

  const instruction = `You are labeling a Blockbench / Minecraft-style 3D model for a RAG search library.

Analyze the model facts (and texture image if provided) carefully.
Return ONLY JSON matching the schema.

Rules:
- category MUST be one of: character, prop, creature, environment
- description: 2–4 sentences on identity/appearance; do not list every animation
- embedding_text: dense search tokens (no sentences); include colors; at most "animated"/"static" for motion
- color_palette: 2–6 dominant color words from the texture, else []
- complexity: prefer analysis.suggested_complexity (simple/medium/complex from cube counts)
- material_tags: ONLY when texture or names clearly support it — do NOT guess from color alone; prefer [] over speculation
- confidence: low|medium|high; needs_review true when low or identity is unclear
- Prefer accurate category over guessing "prop"
- Use bone/element/texture names as evidence (e.g. Head/Arm/Leg => character)`

  const contents = [
    {
      text: `${instruction}\n\nModel analysis JSON:\n${JSON.stringify(analysis, null, 2)}`,
    },
  ]

  if (preview) {
    contents.push({
      inlineData: {
        mimeType: preview.mimeType,
        data: readFileSync(preview.path).toString('base64'),
      },
    })
    contents.push({ text: `Attached texture preview filename: ${preview.name}` })
  }

  const response = await ai.models.generateContent({
    model: LABEL_MODEL,
    contents,
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: LABEL_SCHEMA,
      temperature: 0.2,
    },
  })

  const text = response.text
  if (!text) throw new Error('Empty response from Gemini')

  const label = normalizeLabel(extractJsonObject(text), analysis)
  writeJson(outPath, label)
  return {
    status: 'written',
    category: label.category,
    description: label.description,
    needsReview: label.needs_review,
    usedTexture: Boolean(preview),
  }
}

const ai = new GoogleGenAI({ apiKey: API_KEY })
const folders = resolveModelFolders(targetPath)
let written = 0
let skipped = 0
let failed = 0

console.log(`AI labeling ${folders.length} folder(s) with ${LABEL_MODEL}...\n`)

for (const folderPath of folders) {
  const name = basename(folderPath)
  try {
    const result = await labelFolder(ai, folderPath)
    if (result.status === 'written') {
      written += 1
      console.log(
        `✓ ${name} — ${result.category}${result.usedTexture ? ' +texture' : ''}${result.needsReview ? ' · review' : ''}: ${result.description}`,
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
if (failed > 0) process.exit(1)
