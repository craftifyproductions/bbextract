import { useState } from 'react'
import { modelDataStore } from '../../lib/modelDataStore'
import type { AnimationsManifestEntry, ExtractedAnimation, ExtractedTexture, ProcessedModel } from '../../lib/types'
import { formatBytes } from '../../lib/stats'
import { Button } from '../ui/Button'
import { DownloadModelButton } from '../export/DownloadButtons'
import { TexturesTab } from './TexturesTab'
import { AnimationsTab } from './AnimationsTab'
import { BonesTab } from './BonesTab'
import { AssetInspector, type ModelElementAsset, type SelectedAsset } from './AssetInspector'

interface ModelDetailPanelProps {
  model: ProcessedModel
  onClose: () => void
}

export function ModelDetailPanel({ model, onClose }: ModelDetailPanelProps) {
  const [centerTab, setCenterTab] = useState<'textures' | 'animations'>('textures')
  const [selectedAsset, setSelectedAsset] = useState<SelectedAsset>(null)

  const heavyData = modelDataStore.ensureHeavyData(model.id)
  const geometry = heavyData?.geometry ?? model.geometry
  const rawText = heavyData?.rawText ?? model.rawText
  const storeTextures = heavyData?.textures ?? []
  const animations = heavyData?.animations ?? model.animations

  const resolution = model.metadata.resolution
  const resolutionLabel = resolution ? `${resolution.width}×${resolution.height}` : '—'
  const selectedTextureId = selectedAsset?.type === 'texture' ? selectedAsset.texture.uuid : null
  const selectedAnimationFilename =
    selectedAsset?.type === 'animation' ? selectedAsset.animation.filename : null
  const selectedElementId = selectedAsset?.type === 'element' ? selectedAsset.element.id : null

  const selectTexture = (texture: ExtractedTexture) => {
    setCenterTab('textures')
    setSelectedAsset({ type: 'texture', texture })
  }

  const selectAnimation = (animation: AnimationsManifestEntry | ExtractedAnimation) => {
    setCenterTab('animations')
    setSelectedAsset({ type: 'animation', animation })
  }

  const selectElement = (element: ModelElementAsset) => {
    setSelectedAsset({ type: 'element', element })
  }

  return (
    <div className="-mx-8 -my-8 flex h-[calc(100vh)] flex-col overflow-hidden max-lg:-mx-6 max-md:-mx-4 max-md:-my-5">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface-base px-8 py-4 max-lg:px-6 max-md:flex-wrap max-md:px-4 max-md:py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            ← Back
          </Button>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-text-primary">
              {model.metadata.name}
            </h2>
            <p className="truncate font-mono text-xs text-text-secondary">
              {model.originalFilename}
            </p>
          </div>
        </div>
        <div className="max-md:w-full">
          <DownloadModelButton model={model} size="sm" />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto lg:grid-cols-[300px_1fr_380px] lg:overflow-hidden">
        <aside className="max-h-64 min-h-0 overflow-auto border-b border-border p-3 sm:p-4 lg:max-h-none lg:border-b-0 lg:border-r">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">
            Outliner / Elements
          </h3>
          <BonesTab
            elements={geometry.elements}
            outliner={geometry.outliner}
            selectedElementId={selectedElementId}
            onSelectElement={selectElement}
          />
        </aside>

        <section className="flex min-h-[360px] flex-col overflow-hidden border-b border-border lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="flex shrink-0 gap-1 border-b border-border px-4 pt-3">
            <button
              type="button"
              onClick={() => setCenterTab('textures')}
              className={`rounded-t border-b-2 px-3 py-2 text-xs transition-colors ${
                centerTab === 'textures'
                  ? 'border-accent text-text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              Textures ({storeTextures.length || model.textures.length})
            </button>
            <button
              type="button"
              onClick={() => setCenterTab('animations')}
              className={`rounded-t border-b-2 px-3 py-2 text-xs transition-colors ${
                centerTab === 'animations'
                  ? 'border-accent text-text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              Animations ({animations.length || model.animations.length})
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
            {centerTab === 'textures' ? (
              <TexturesTab
                textures={storeTextures}
                selectedTextureId={selectedTextureId}
                onSelectTexture={selectTexture}
              />
            ) : (
              <AnimationsTab
                animations={animations.length ? animations : model.animations}
                selectedAnimationFilename={selectedAnimationFilename}
                onSelectAnimation={selectAnimation}
              />
            )}
          </div>
        </section>

        <aside className="min-h-[320px] overflow-auto p-3 sm:p-4 lg:min-h-0">
          <AssetInspector
            selectedAsset={selectedAsset}
            modelMeta={{
              resolutionLabel,
              formatLabel: String(model.metadata.format_version ?? '—'),
              elements: model.summary.elementCount,
              bones: model.summary.boneCount,
              textures: model.summary.textureCount,
              animations: model.summary.animationCount,
              keyframes: model.summary.totalKeyframes,
              sizeLabel: `${formatBytes(model.originalSizeBytes)} → ${formatBytes(model.extractedSizeBytes)}`,
              extractedAt: new Date(model.summary.extractedAt).toLocaleString(),
            }}
            rawText={rawText}
            summary={model.summary as unknown as Record<string, unknown>}
          />
        </aside>
      </div>
    </div>
  )
}
