export interface DecodedTextureBuffer {
  buffer: ArrayBuffer
  mime: string
}

export function decodeTextureToBuffer(source: unknown): DecodedTextureBuffer | null {
  if (typeof source !== 'string' || source.length === 0) {
    return null
  }

  try {
    let base64 = source
    let mime = 'image/png'

    if (source.startsWith('data:')) {
      const match = /^data:([^;]+);base64,(.+)$/s.exec(source)
      if (!match) return null
      mime = match[1] ?? 'image/png'
      base64 = match[2] ?? ''
    }

    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }

    return { buffer: bytes.buffer, mime }
  } catch {
    return null
  }
}

export function decodeTexture(source: unknown): Blob | null {
  const decoded = decodeTextureToBuffer(source)
  if (!decoded) return null
  return new Blob([decoded.buffer], { type: decoded.mime })
}
