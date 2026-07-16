#!/usr/bin/env node
import { readFileSync } from 'node:fs'

const INVALID_CHARS = /[<>:"/\\|?*\x00-\x1f]/g

function sanitizeFolderName(name) {
  const cleaned = name
    .trim()
    .replace(INVALID_CHARS, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 100)
  return cleaned || 'model'
}

function sanitizeFileName(name, ext = '') {
  const withoutExt = name.replace(/\.[^.]+$/, '')
  const base = sanitizeFolderName(withoutExt)
  if (!ext) return base
  const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`
  return `${base}${normalizedExt}`
}

function makeUniqueFilename(baseName, ext, usedNames, uuid) {
  let candidate = sanitizeFileName(baseName, ext)
  if (!usedNames.has(candidate)) {
    usedNames.add(candidate)
    return candidate
  }

  const suffix = uuid.slice(0, 8)
  candidate = sanitizeFileName(`${baseName}_${suffix}`, ext)
  let counter = 1
  while (usedNames.has(candidate)) {
    candidate = sanitizeFileName(`${baseName}_${suffix}_${counter}`, ext)
    counter++
    if (counter > 50) {
      console.error('LOOP DETECTED', { baseName, suffix, candidate, used: [...usedNames] })
      break
    }
  }

  usedNames.add(candidate)
  return candidate
}

const file = process.argv[2]
if (!file) {
  console.error('Usage: node scripts/analyze-animations.mjs <file.bbmodel>')
  process.exit(1)
}

const raw = JSON.parse(readFileSync(file, 'utf8'))
console.log('Root keys:', Object.keys(raw).sort().join(', '))
console.log('groups:', raw.groups?.length, 'outliner roots:', raw.outliner?.length)
console.log('animations:', raw.animations?.length)

const usedNames = new Set()
for (const item of raw.animations ?? []) {
  const name =
    typeof item.name === 'string' && item.name.trim()
      ? item.name
      : `animation_${usedNames.size}`
  const uuid = typeof item.uuid === 'string' ? item.uuid : 'no-uuid'
  console.log('\nAnimation:', JSON.stringify(name), 'uuid:', uuid.slice(0, 8))
  const direct = sanitizeFileName(name, 'json')
  console.log('  sanitized:', direct)
  const filename = makeUniqueFilename(name, 'json', usedNames, uuid)
  console.log('  filename:', filename)
}
