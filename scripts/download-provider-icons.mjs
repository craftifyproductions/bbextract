import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'provider-icons')
mkdirSync(outDir, { recursive: true })

/** Prefer LobeHub color marks when available; fall back to Simple Icons. */
const downloads = [
  ['google.svg', 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/gemini-color.svg'],
  ['anthropic.svg', 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/claude-color.svg'],
  ['openai.svg', 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openai.svg'],
  ['nvidia.svg', 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/nvidia-color.svg'],
  ['meta.svg', 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/meta-color.svg'],
  ['qwen.svg', 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/qwen-color.svg'],
  ['minimax.svg', 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/minimax-color.svg'],
  ['stepfun.svg', 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/stepfun.svg'],
  ['xiaomi.svg', 'https://cdn.simpleicons.org/xiaomi/FF6900'],
  ['openrouter.svg', 'https://cdn.simpleicons.org/openrouter/94A3B8'],
]

for (const [name, url] of downloads) {
  const response = await fetch(url)
  if (!response.ok) {
    console.error('FAIL', name, response.status, url)
    continue
  }
  let body = await response.text()
  if (name === 'openai.svg' && !/fill=/.test(body)) {
    body = body.replace('<svg', '<svg fill="#FFFFFF"')
  }
  writeFileSync(join(outDir, name), body)
  console.log('OK', name)
}
