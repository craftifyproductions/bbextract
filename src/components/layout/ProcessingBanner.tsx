import type { QueueInfo } from '../../hooks/useProcessingProgress'

interface ProcessingBannerProps {
  queueInfo: QueueInfo
}

export function ProcessingBanner({ queueInfo }: ProcessingBannerProps) {
  const current = Math.min(queueInfo.current || 1, queueInfo.total)

  return (
    <div className="shrink-0 border-b border-border bg-surface-elevated px-8 py-2 max-lg:px-6 max-md:px-4 max-md:pb-2">
      <p className="font-mono text-xs text-accent-warm">
        Processing {current} of {queueInfo.total} file{queueInfo.total === 1 ? '' : 's'}…
      </p>
    </div>
  )
}
