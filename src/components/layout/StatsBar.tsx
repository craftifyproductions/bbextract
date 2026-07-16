import { memo, useMemo } from 'react'
import type { ProcessedModel } from '../../lib/types'
import { computeAggregateStats } from '../../lib/stats'

interface StatsBarProps {
  models: ProcessedModel[]
}

function areStatsBarPropsEqual(prev: StatsBarProps, next: StatsBarProps): boolean {
  if (prev.models === next.models) return true
  if (prev.models.length !== next.models.length) return false

  for (let index = 0; index < prev.models.length; index += 1) {
    const prevModel = prev.models[index]
    const nextModel = next.models[index]
    if (prevModel.id !== nextModel.id) return false
    if (prevModel.status !== nextModel.status) return false
    if (prevModel.status === 'done' && nextModel.status === 'done') {
      if (prevModel.textures.length !== nextModel.textures.length) return false
      if (prevModel.animations.length !== nextModel.animations.length) return false
      if (prevModel.summary.elementCount !== nextModel.summary.elementCount) return false
    }
  }

  return true
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded border border-border bg-surface-base/60 px-3 py-2 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
      <span className="text-xs uppercase tracking-wide text-text-secondary sm:text-sm">{label}</span>
      <span className="font-mono text-xl font-medium text-text-primary sm:text-2xl">{value}</span>
    </div>
  )
}

export const StatsBar = memo(function StatsBar({ models }: StatsBarProps) {
  const stats = useMemo(
    () => computeAggregateStats(models.filter((model) => model.status === 'done')),
    [models],
  )

  if (stats.modelCount === 0) return null

  return (
    <section className="mb-5 grid gap-2 border-b border-border pb-4 sm:mb-8 sm:flex sm:flex-wrap sm:items-center sm:gap-x-10 sm:gap-y-3 sm:pb-6">
      <Stat label="Total models" value={stats.modelCount} />
      <Stat label="Textures" value={stats.textureCount} />
      <Stat label="Animations" value={stats.animationCount} />
      <Stat label="Elements" value={stats.elementCount} />
    </section>
  )
}, areStatsBarPropsEqual)
