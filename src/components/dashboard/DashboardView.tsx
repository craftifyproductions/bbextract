import { useState } from 'react'
import type { ConsoleLine } from '../../hooks/useConsole'
import type { ProcessedModel } from '../../lib/types'
import { LogsPanel } from '../logs/LogsPanel'
import { ConsolePanel } from './ConsolePanel'
import { StoredStatsPanel } from './StoredStatsPanel'

type DashboardTab = 'stats' | 'logs' | 'console'

interface DashboardViewProps {
  models: ProcessedModel[]
  authenticated: boolean
  hasModels: boolean
  doneCount: number
  onClear: () => void
  onLogRefresh?: (refresh: () => void) => void
  consoleLines: ConsoleLine[]
  onClearConsole: () => void
  onCopyConsole: () => void
}

export function DashboardView({
  models,
  authenticated,
  hasModels,
  doneCount,
  onClear,
  onLogRefresh,
  consoleLines,
  onClearConsole,
  onCopyConsole,
}: DashboardViewProps) {
  const [activeTab, setActiveTab] = useState<DashboardTab>('stats')

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3 sm:mb-6 sm:gap-4">
        <div>
          <h1 className="mb-1 text-2xl font-semibold text-text-primary max-sm:text-xl">Dashboard</h1>
          <p className="text-base text-text-secondary max-sm:text-sm">
            {doneCount} model{doneCount === 1 ? '' : 's'} extracted
          </p>
        </div>
        {hasModels ? (
          <button
            type="button"
            onClick={onClear}
            className="rounded border border-border px-3 py-2 text-sm text-text-secondary transition-colors hover:border-border hover:bg-surface-elevated hover:text-text-primary max-sm:w-full"
          >
            Clear all models
          </button>
        ) : null}
      </div>

      <div className="mb-5 flex gap-1 overflow-x-auto rounded border border-border bg-surface-elevated/40 p-1 sm:mb-6">
        <TabButton
          active={activeTab === 'stats'}
          onClick={() => setActiveTab('stats')}
          label="Stats"
          badge={doneCount > 0 ? doneCount : undefined}
        />
        <TabButton active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} label="Logs" />
        <TabButton
          active={activeTab === 'console'}
          onClick={() => setActiveTab('console')}
          label="Console"
          badge={consoleLines.length > 0 ? consoleLines.length : undefined}
        />
      </div>

      {activeTab === 'stats' ? (
        <StoredStatsPanel models={models} />
      ) : activeTab === 'logs' ? (
        <LogsPanel authenticated={authenticated} onReady={onLogRefresh} />
      ) : (
        <ConsolePanel lines={consoleLines} onClear={onClearConsole} onCopy={onCopyConsole} />
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean
  onClick: () => void
  label: string
  badge?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded px-3 py-2 text-sm transition-colors sm:flex-none sm:px-4 ${
        active
          ? 'bg-surface-elevated text-text-primary'
          : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      {label}
      {badge !== undefined ? (
        <span className="rounded border border-border bg-surface-base px-1.5 py-0.5 font-mono text-xs text-text-secondary">
          {badge}
        </span>
      ) : null}
    </button>
  )
}
