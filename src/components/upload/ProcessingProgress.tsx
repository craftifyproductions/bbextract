import type { ProcessingProgressDetail, ProcessingStage } from '../../lib/types'

const STAGE_PROGRESS: Record<ProcessingStage, number> = {
  parsing: 20,
  extracting_animations: 40,
  decoding_textures: 55,
  building_structure: 85,
  done: 100,
  error: 100,
}

function getStageLabel(stage: ProcessingStage, detail?: ProcessingProgressDetail): string {
  switch (stage) {
    case 'parsing':
      return detail?.elementCount
        ? `Parsing ${detail.elementCount} elements…`
        : 'Parsing model JSON…'
    case 'decoding_textures':
      return detail?.textureCount
        ? `Decoding ${detail.textureCount} texture${detail.textureCount === 1 ? '' : 's'}…`
        : 'Decoding textures…'
    case 'extracting_animations':
      return detail?.animationCount
        ? `Extracting ${detail.animationCount} animation${detail.animationCount === 1 ? '' : 's'}…`
        : 'Extracting animations…'
    case 'building_structure':
      return detail?.animationCount
        ? `Building ${detail.animationCount} animation${detail.animationCount === 1 ? '' : 's'}…`
        : 'Building structure…'
    case 'done':
      return 'Complete'
    case 'error':
      return 'Error'
  }
}

interface ProcessingProgressProps {
  stage: ProcessingStage
  filename: string
  queueLabel?: string
  detail?: ProcessingProgressDetail
}

export function ProcessingProgress({
  stage,
  filename,
  queueLabel,
  detail,
}: ProcessingProgressProps) {
  const progress = STAGE_PROGRESS[stage]
  const stageLabel = getStageLabel(stage, detail)

  return (
    <div className="rounded border border-border bg-surface-elevated p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="truncate font-mono text-xs text-text-primary">{filename}</p>
        <span className="shrink-0 font-mono text-xs text-accent-warm">
          {queueLabel ?? stageLabel}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-sm bg-surface-base">
        <div
          className="h-full bg-accent-warm transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      {queueLabel ? (
        <p className="mt-2 font-mono text-xs text-text-secondary">{stageLabel}</p>
      ) : null}
    </div>
  )
}
