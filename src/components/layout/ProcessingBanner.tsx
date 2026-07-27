import type { QueueInfo, UploadInfo } from '../../hooks/useProcessingProgress'
import type { ProcessingProgressDetail, ProcessingStage } from '../../lib/types'
import { getQueueProcessingPercent, getStageLabel } from '../upload/ProcessingProgress'

interface ProcessingBannerProps {
  queueInfo?: QueueInfo | null
  uploadInfo?: UploadInfo | null
  activeProcessingId?: string | null
  getProgress?: (
    id: string,
  ) => ({ stage: ProcessingStage } & ProcessingProgressDetail) | undefined
  currentFilename?: string | null
  onCancel?: () => void
}

export function ProcessingBanner({
  queueInfo,
  uploadInfo,
  activeProcessingId,
  getProgress,
  currentFilename,
  onCancel,
}: ProcessingBannerProps) {
  // Upload (persisting to storage) takes visual priority once it starts.
  if (uploadInfo && uploadInfo.total > 0) {
    const current = Math.min(uploadInfo.current, uploadInfo.total)
    const percent = Math.round((current / uploadInfo.total) * 100)
    return (
      <BannerBar
        primary="Uploading to saved library…"
        secondary={`${current} of ${uploadInfo.total} item${uploadInfo.total === 1 ? '' : 's'}`}
        percent={percent}
        onCancel={onCancel}
      />
    )
  }

  if (queueInfo && queueInfo.total > 0) {
    const current = Math.min(queueInfo.current || 1, queueInfo.total)
    const progress =
      activeProcessingId && getProgress ? getProgress(activeProcessingId) : undefined
    const stage = progress?.stage ?? 'parsing'
    const stageLabel = getStageLabel(stage, progress)
    const filename = currentFilename?.trim() || 'Processing file…'
    const percent = getQueueProcessingPercent(current, queueInfo.total, stage)

    return (
      <BannerBar
        primary={filename}
        secondary={`File ${current} of ${queueInfo.total} · ${stageLabel}`}
        percent={percent}
        onCancel={onCancel}
      />
    )
  }

  return null
}

function BannerBar({
  primary,
  secondary,
  percent,
  onCancel,
}: {
  primary: string
  secondary: string
  percent: number
  onCancel?: () => void
}) {
  return (
    <div className="shrink-0 border-b border-border bg-surface-elevated px-8 py-2 max-lg:px-6 max-md:px-4 max-md:pb-2">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs text-text-primary">{primary}</p>
          <p className="truncate font-mono text-[11px] text-accent-warm">{secondary}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-xs text-text-secondary">{percent}%</span>
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-text-secondary transition-colors hover:border-red-500/50 hover:text-red-300"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>
      <div className="h-1 overflow-hidden rounded-sm bg-surface-base">
        <div
          className="h-full bg-accent-warm transition-all duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
