#!/usr/bin/env node
/**
 * One-command RAG prepare: model.json + AI label.json
 *
 * Usage (from a model folder):
 *   prepare-rag
 *   prepare-rag --force
 *
 * Or with an explicit path:
 *   node scripts/prepare-rag-folder.mjs <folder> [--force] [--heuristic]
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from './lib/ragFolderUtils.mjs'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const { force, heuristic, targetPath } = parseArgs(process.argv)

if (!targetPath) {
  console.error(
    'Usage: node scripts/prepare-rag-folder.mjs [model-folder-or-parent] [--force] [--heuristic]',
  )
  process.exit(1)
}

function runScript(scriptName) {
  const scriptPath = join(scriptsDir, scriptName)
  const args = [scriptPath, targetPath]
  if (force) args.push('--force')
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log(`Preparing RAG files in: ${targetPath}\n`)
console.log('=== 1/2 Building model.json ===')
runScript('build-model-json.mjs')

console.log(`\n=== 2/2 Building label.json (${heuristic ? 'heuristic' : 'Gemini AI'}) ===`)
runScript(heuristic ? 'build-label-json.mjs' : 'build-label-json-ai.mjs')

console.log('\nAll done. Check each model folder for model.json + label.json.')
