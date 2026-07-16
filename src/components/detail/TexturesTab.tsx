import type { ExtractedTexture } from '../../lib/types'

interface TexturesTabProps {
  textures: ExtractedTexture[]
  selectedTextureId?: string | null
  onSelectTexture?: (texture: ExtractedTexture) => void
}

export function TexturesTab({ textures, selectedTextureId, onSelectTexture }: TexturesTabProps) {
  if (textures.length === 0) {
    return <p className="text-xs text-text-secondary">No textures in this model.</p>
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {textures.map((texture) => (
        <button
          type="button"
          key={texture.uuid}
          onClick={() => onSelectTexture?.(texture)}
          className={`overflow-hidden rounded border bg-surface-elevated text-left transition-colors ${
            selectedTextureId === texture.uuid
              ? 'border-accent ring-1 ring-accent/40'
              : 'border-border hover:border-accent/50'
          }`}
        >
          <div className="flex aspect-square items-center justify-center bg-checkerboard p-2">
            <img
              src={texture.previewUrl}
              alt={texture.name}
              className="max-h-full max-w-full object-contain"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>
          <div className="border-t border-border px-2 py-2">
            <p className="truncate text-xs text-text-primary">{texture.name}</p>
            <p className="font-mono text-xs text-text-secondary">
              {texture.width}×{texture.height}
            </p>
          </div>
        </button>
      ))}
    </div>
  )
}
