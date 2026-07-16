import { memo, useEffect, useState } from 'react'
import { modelDataStore } from '../../lib/modelDataStore'
import type { ProcessedModel, ProcessingProgressDetail, ProcessingStage } from '../../lib/types'
import { formatBytes } from '../../lib/stats'
import { Button } from '../ui/Button'
import { WireframeCube } from '../ui/WireframeCube'
import { DownloadModelButton } from '../export/DownloadButtons'
import { ProcessingProgress } from '../upload/ProcessingProgress'

interface ModelCardProps {
  model: ProcessedModel
  onViewDetails: (id: string) => void
  processingStage?: ProcessingStage
  processingDetail?: ProcessingProgressDetail
  queueLabel?: string
}

function areModelCardPropsEqual(prev: ModelCardProps, next: ModelCardProps): boolean {
  if (prev.onViewDetails !== next.onViewDetails) return false
  if (prev.processingStage !== next.processingStage) return false
  if (prev.queueLabel !== next.queueLabel) return false
  if (prev.processingDetail !== next.processingDetail) return false

  const prevModel = prev.model
  const nextModel = next.model

  if (prevModel.id !== nextModel.id) return false
  if (prevModel.status !== nextModel.status) return false
  if (prevModel.error !== nextModel.error) return false
  if (prevModel.originalFilename !== nextModel.originalFilename) return false
  if (prevModel.originalSizeBytes !== nextModel.originalSizeBytes) return false
  if (prevModel.extractedSizeBytes !== nextModel.extractedSizeBytes) return false
  if (prevModel.metadata.name !== nextModel.metadata.name) return false

  const prevResolution = prevModel.metadata.resolution
  const nextResolution = nextModel.metadata.resolution
  if (prevResolution?.width !== nextResolution?.width) return false
  if (prevResolution?.height !== nextResolution?.height) return false

  const prevThumb = modelDataStore.getTextures(prevModel.id)[0]?.previewUrl
  const nextThumb = modelDataStore.getTextures(nextModel.id)[0]?.previewUrl
  if (prevThumb !== nextThumb) return false

  const prevSummary = prevModel.summary
  const nextSummary = nextModel.summary
  return (
    prevSummary.elementCount === nextSummary.elementCount &&
    prevSummary.boneCount === nextSummary.boneCount &&
    prevSummary.textureCount === nextSummary.textureCount &&
    prevSummary.animationCount === nextSummary.animationCount
  )
}

export const ModelCard = memo(function ModelCard({
  model,
  onViewDetails,
  processingStage,
  processingDetail,
  queueLabel,
}: ModelCardProps) {
  const [showCube, setShowCube] = useState(false)

  useEffect(() => {
    if (model.status !== 'done') return
    setShowCube(true)
    const timer = window.setTimeout(() => setShowCube(false), 1200)
    return () => window.clearTimeout(timer)
  }, [model.status, model.id])

  if (model.status === 'processing') {
    return (
      <ProcessingProgress
        stage={processingStage ?? model.progress ?? 'parsing'}
        filename={model.originalFilename}
        queueLabel={queueLabel}
        detail={processingDetail}
      />
    )
  }

  if (model.status === 'error') {
    return (
      <div className="rounded border border-red-500/40 bg-surface-elevated p-3">
        <p className="truncate text-sm text-text-primary">{model.metadata.name}</p>
        <p className="mt-0.5 truncate font-mono text-xs text-text-secondary">
          {model.originalFilename}
        </p>
        <p className="mt-2 text-xs text-red-300">{model.error ?? 'Failed to process model'}</p>
      </div>
    )
  }

  const resolution = model.metadata.resolution
  const resolutionLabel = resolution ? `${resolution.width}×${resolution.height}` : '—'
  const thumbnail = modelDataStore.getTextures(model.id)[0]

  return (
    <article className="group rounded border border-border bg-surface-elevated p-3 transition-colors hover:border-accent/40">
      <div className="flex gap-3">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded border border-border bg-checkerboard">
          {thumbnail ? (
            <img
              src={thumbnail.previewUrl}
              alt=""
              className="h-full w-full object-contain"
              style={{ imageRendering: 'pixelated' }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center font-mono text-xs text-text-secondary">
              —
            </div>
          )}
          {showCube ? (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-base/80">
              <WireframeCube size={28} />
            </div>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-base font-medium text-text-primary">
                {model.metadata.name}
              </h3>
              <p className="truncate font-mono text-sm text-text-secondary">
                {model.originalFilename}
              </p>
            </div>
            <span className="shrink-0 font-mono text-sm text-accent">{resolutionLabel}</span>
          </div>

          <p className="mt-2 font-mono text-sm text-text-secondary">
            {model.summary.elementCount} el · {model.summary.boneCount} bones ·{' '}
            {model.summary.textureCount} tex · {model.summary.animationCount} anim
          </p>

          <p className="mt-1 font-mono text-xs text-text-secondary/80">
            {formatBytes(model.originalSizeBytes)} → {formatBytes(model.extractedSizeBytes)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex gap-2 border-t border-border pt-3">
        <Button variant="primary" size="sm" onClick={() => onViewDetails(model.id)}>
          Open
        </Button>
        <DownloadModelButton model={model} size="sm" />
      </div>
    </article>
  )
}, areModelCardPropsEqual)

export type ModelSortField = 'name' | 'textures' | 'animations' | 'date'

export function sortModels(models: ProcessedModel[], sortBy: ModelSortField): ProcessedModel[] {
  const done = models.filter((m) => m.status === 'done')
  const rest = models.filter((m) => m.status !== 'done')

  const sorted = [...done].sort((a, b) => {
    switch (sortBy) {
      case 'name':
        return a.metadata.name.localeCompare(b.metadata.name)
      case 'textures':
        return b.summary.textureCount - a.summary.textureCount
      case 'animations':
        return b.summary.animationCount - a.summary.animationCount
      case 'date':
        return (
          new Date(b.summary.extractedAt).getTime() - new Date(a.summary.extractedAt).getTime()
        )
    }
  })

  return [...rest, ...sorted]
}
