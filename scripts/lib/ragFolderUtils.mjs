/**
 * Shared helpers for RAG prepare scripts (model.json / label.json).
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'

export const CATEGORIES = ['character', 'prop', 'creature', 'environment']

const SKIP_DIR_NAMES = new Set(['geometry', 'textures', 'animations', 'node_modules', '.git'])

export function parseArgs(argv) {
  const args = argv.slice(2)
  const force = args.includes('--force')
  const heuristic = args.includes('--heuristic')
  const positional = args.filter((arg) => !arg.startsWith('--'))
  // Default to the folder where the command is run (handy in model directories).
  return { force, heuristic, targetPath: positional[0] ?? process.cwd() }
}

export function readJson(filePath) {
  // Strip UTF-8 BOM if present (common on Windows-created files).
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
  return JSON.parse(raw)
}

export function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function isModelFolder(dirPath) {
  if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) return false
  return (
    existsSync(join(dirPath, 'metadata.json')) ||
    existsSync(join(dirPath, 'summary.json')) ||
    existsSync(join(dirPath, 'geometry')) ||
    existsSync(join(dirPath, 'model.json')) ||
    hasBbmodelFile(dirPath)
  )
}

export function hasBbmodelFile(dirPath) {
  return findBbmodelFile(dirPath) != null
}

export function findBbmodelFile(dirPath) {
  const entries = readdirSync(dirPath)
  const match = entries.find((name) => name.toLowerCase().endsWith('.bbmodel'))
  return match ? join(dirPath, match) : null
}

/**
 * Resolve one model folder, or all child model folders under a parent directory.
 */
export function resolveModelFolders(targetPath) {
  if (!targetPath) {
    throw new Error('Missing path. Pass a model folder or a parent folder of models.')
  }
  if (!existsSync(targetPath)) {
    throw new Error(`Path not found: ${targetPath}`)
  }

  const stat = statSync(targetPath)
  if (!stat.isDirectory()) {
    throw new Error(`Path must be a directory: ${targetPath}`)
  }

  if (isModelFolder(targetPath)) {
    return [targetPath]
  }

  const children = readdirSync(targetPath)
    .map((name) => join(targetPath, name))
    .filter((childPath) => {
      if (!statSync(childPath).isDirectory()) return false
      const name = basename(childPath)
      if (SKIP_DIR_NAMES.has(name)) return false
      return isModelFolder(childPath)
    })
    .sort((a, b) => a.localeCompare(b))

  if (children.length === 0) {
    throw new Error(
      `No model folders found under ${targetPath}. Expected folders with metadata.json / geometry / .bbmodel.`,
    )
  }

  return children
}

export function loadOptionalJson(filePath) {
  if (!existsSync(filePath)) return null
  try {
    return readJson(filePath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse ${filePath}: ${message}`)
  }
}

export function listJsonFiles(dirPath, { exclude = [] } = {}) {
  if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) return []
  const excludeSet = new Set(exclude.map((name) => name.toLowerCase()))
  return readdirSync(dirPath)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .filter((name) => !excludeSet.has(name.toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => join(dirPath, name))
}

export function humanizeFolderName(name) {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function guessCategory(text) {
  const hay = text.toLowerCase()

  const rules = [
    {
      category: 'creature',
      keywords: [
        'creature',
        'animal',
        'mob',
        'fox',
        'wolf',
        'dragon',
        'bird',
        'fish',
        'insect',
        'monster',
        'beast',
        'pet',
      ],
    },
    {
      category: 'character',
      keywords: [
        'character',
        'player',
        'npc',
        'human',
        'person',
        'hero',
        'villager',
        'soldier',
        'warrior',
        'mage',
        'knight',
      ],
    },
    {
      category: 'environment',
      keywords: [
        'environment',
        'terrain',
        'tree',
        'rock',
        'building',
        'house',
        'castle',
        'plant',
        'bush',
        'landscape',
        'scene',
      ],
    },
    {
      category: 'prop',
      keywords: [
        'prop',
        'item',
        'weapon',
        'sword',
        'tool',
        'chest',
        'crate',
        'furniture',
        'chair',
        'table',
        'vehicle',
        'car',
      ],
    },
  ]

  for (const rule of rules) {
    if (rule.keywords.some((keyword) => hay.includes(keyword))) {
      return rule.category
    }
  }

  return 'prop'
}

export function uniqueStrings(values) {
  const seen = new Set()
  const out = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}
