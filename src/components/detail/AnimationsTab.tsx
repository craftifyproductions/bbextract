import type { AnimationsManifestEntry, ExtractedAnimation } from '../../lib/types'

interface AnimationsTabProps {
  animations: AnimationsManifestEntry[] | ExtractedAnimation[]
  selectedAnimationFilename?: string | null
  onSelectAnimation?: (animation: AnimationsManifestEntry | ExtractedAnimation) => void
}

export function AnimationsTab({
  animations,
  selectedAnimationFilename,
  onSelectAnimation,
}: AnimationsTabProps) {
  if (animations.length === 0) {
    return <p className="text-xs text-text-secondary">No animations in this model.</p>
  }

  const maxKeyframes = Math.max(...animations.map((anim) => anim.keyframeCount), 1)

  return (
    <div className="space-y-2">
      {animations.map((animation) => {
        const barWidth = (animation.keyframeCount / maxKeyframes) * 100
        const loopLabel =
          animation.loop === true || animation.loop === 'hold'
            ? 'Loop'
            : animation.loop
              ? String(animation.loop)
              : 'Once'

        return (
          <button
            type="button"
            key={animation.filename}
            onClick={() => onSelectAnimation?.(animation)}
            className={`w-full rounded border bg-surface-base p-3 text-left transition-colors ${
              selectedAnimationFilename === animation.filename
                ? 'border-accent ring-1 ring-accent/40'
                : 'border-border hover:border-accent/50'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-text-primary">{animation.name}</p>
              <span className="rounded border border-border px-1.5 py-0.5 font-mono text-xs text-text-secondary">
                {loopLabel}
              </span>
            </div>
            <p className="mt-1 font-mono text-xs text-text-secondary">
              {animation.length}s · {animation.keyframeCount} keyframes
            </p>
            <div className="mt-2 h-1 overflow-hidden rounded-sm bg-surface-elevated">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${barWidth}%` }}
              />
            </div>
          </button>
        )
      })}
    </div>
  )
}
