const INVALID_CHARS = /[<>:"/\\|?*\x00-\x1f]/g

export function sanitizeFolderName(name: string): string {
  const cleaned = name
    .trim()
    .replace(INVALID_CHARS, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 100)

  return cleaned || 'model'
}

export function sanitizeFileName(name: string, ext = ''): string {
  const withoutExt = name.replace(/\.[^.]+$/, '')
  const base = sanitizeFolderName(withoutExt)
  if (!ext) return base
  const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`
  return `${base}${normalizedExt}`
}

export function filenameWithoutExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  if (lastDot <= 0) return filename
  return filename.slice(0, lastDot)
}

function attachExtension(baseName: string, ext: string): string {
  const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`
  return `${sanitizeFolderName(baseName)}${normalizedExt}`
}

export function makeUniqueFilename(
  baseName: string,
  ext: string,
  usedNames: Set<string>,
  uuid: string,
): string {
  // Use attachExtension (not sanitizeFileName) so dotted Blockbench names like
  // "animation.sunman.walk" keep their suffix when uniquifying — sanitizeFileName
  // strips the last dot segment as a faux file extension and causes infinite loops.
  let candidate = attachExtension(baseName, ext)
  if (!usedNames.has(candidate)) {
    usedNames.add(candidate)
    return candidate
  }

  const suffix = uuid.slice(0, 8)
  candidate = attachExtension(`${baseName}_${suffix}`, ext)
  let counter = 1
  const maxAttempts = 10_000
  while (usedNames.has(candidate)) {
    if (counter > maxAttempts) {
      candidate = attachExtension(`${baseName}_${uuid}`, ext)
      break
    }
    candidate = attachExtension(`${baseName}_${suffix}_${counter}`, ext)
    counter++
  }

  usedNames.add(candidate)
  return candidate
}
