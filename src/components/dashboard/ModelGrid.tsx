import { useMemo, useState } from 'react'
import type { ProcessedModel, ProcessingProgressDetail, ProcessingStage } from '../../lib/types'
import { DownloadAllButton } from '../export/DownloadButtons'
import { ModelCard, sortModels, type ModelSortField } from './ModelCard'

interface ModelGridProps {
  models: ProcessedModel[]
  searchQuery: string
  onViewDetails: (id: string) => void
  getProgress: (
    id: string,
  ) => ({ stage: ProcessingStage } & ProcessingProgressDetail) | undefined
  queueInfo: { current: number; total: number } | null
  activeProcessingId: string | null
}

const sortOptions: { value: ModelSortField; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'textures', label: 'Textures' },
  { value: 'animations', label: 'Animations' },
  { value: 'date', label: 'Date processed' },
]

export function ModelGrid({
  models,
  searchQuery,
  onViewDetails,
  getProgress,
  queueInfo,
  activeProcessingId,
}: ModelGridProps) {
  const [sortBy, setSortBy] = useState<ModelSortField>('date')
  const filteredModels = useMemo(() => filterModels(models, searchQuery), [models, searchQuery])
  const sortedModels = useMemo(() => sortModels(filteredModels, sortBy), [filteredModels, sortBy])
  const doneCount = models.filter((m) => m.status === 'done').length

  if (models.length === 0) return null

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-text-secondary">Sort by</span>
          {sortOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setSortBy(option.value)}
              className={`rounded border px-3 py-1.5 text-sm transition-colors ${
                sortBy === option.value
                  ? 'border-accent/50 bg-accent/10 text-accent'
                  : 'border-border text-text-secondary hover:border-border hover:text-text-primary'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {doneCount > 1 ? <DownloadAllButton models={models} /> : null}
      </div>

      {sortedModels.length === 0 ? (
        <div className="rounded border border-border bg-surface-elevated p-4">
          <p className="text-sm text-text-secondary">No current models match your search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {sortedModels.map((model) => {
            const isActive = model.id === activeProcessingId
            const queueLabel =
              isActive && queueInfo && queueInfo.total > 1
                ? `Processing ${queueInfo.current} of ${queueInfo.total}…`
                : undefined
            const progress = getProgress(model.id)

            return (
              <ModelCard
                key={model.id}
                model={model}
                onViewDetails={onViewDetails}
                processingStage={progress?.stage}
                processingDetail={progress}
                queueLabel={queueLabel}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

function filterModels(models: ProcessedModel[], searchQuery: string): ProcessedModel[] {
  if (!searchQuery.trim()) return models

  const query = searchQuery.toLowerCase()
  return models.filter((model) =>
    [
      model.metadata.name,
      model.originalFilename,
      model.folderName,
      model.status,
      String(model.summary.textureCount),
      String(model.summary.animationCount),
    ].some((value) => value.toLowerCase().includes(query)),
  )
}
