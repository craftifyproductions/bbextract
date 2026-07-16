#!/usr/bin/env node
/**
 * Batch diagnose .bbmodel files from the command line.
 * Usage: node scripts/batch-diagnose.mjs file1.bbmodel file2.bbmodel
 */
import { readFileSync, statSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Usage: node scripts/batch-diagnose.mjs <file.bbmodel> [...]')
  process.exit(1)
}

const parseModelPath = pathToFileURL(
  fileURLToPath(new URL('../src/lib/parseModel.ts', import.meta.url)),
).href

const { processModelBuffer } = await import(parseModelPath)

console.log(`Diagnosing ${args.length} file(s)...\n`)

for (let index = 0; index < args.length; index += 1) {
  const filePath = args[index]
  const stat = statSync(filePath)
  const memBefore = process.memoryUsage().heapUsed

  const t0 = performance.now()
  const buffer = readFileSync(filePath)
  const tRead = performance.now()

  const checkpoints = []
  const processed = processModelBuffer(buffer, filePath, stat.size, (stage) => {
    checkpoints.push(`${stage}@${(performance.now() - tRead).toFixed(0)}ms`)
  })
  const tWorker = performance.now()

  if (processed.error) {
    console.log(`${index + 1}/${args.length} ${filePath} — ERROR: ${processed.error}`)
    continue
  }

  const memAfter = process.memoryUsage().heapUsed
  const slimSize = JSON.stringify({
    metadata: processed.result.metadata,
    summary: processed.result.summary,
  }).length

  console.log(
    [
      `${index + 1}/${args.length}`,
      filePath.split(/[/\\]/).pop(),
      `${stat.size} bytes`,
      `read ${(tRead - t0).toFixed(0)}ms`,
      `worker ${(tWorker - tRead).toFixed(0)}ms`,
      `slim ${(slimSize / 1024).toFixed(1)}KB`,
      `heap +${((memAfter - memBefore) / 1024 / 1024).toFixed(1)}MB`,
    ].join(' | '),
  )
  if (checkpoints.length > 0) {
    console.log(`  checkpoints: ${checkpoints.join(' → ')}`)
  }
}

console.log('\nDone.')
