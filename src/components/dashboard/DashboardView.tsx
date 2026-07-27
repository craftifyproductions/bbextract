import { useEffect, useRef, useState } from 'react'
import type { ConsoleLine } from '../../hooks/useConsole'
import type { QueueInfo } from '../../hooks/useProcessingProgress'
import type { ProcessedModel, ProcessingProgressDetail, ProcessingStage } from '../../lib/types'
import { StatsBar } from '../layout/StatsBar'
import { LogsPanel } from '../logs/LogsPanel'
import { ConsolePanel } from './ConsolePanel'
import { ModelGrid } from './ModelGrid'
import { StoredFilesPanel } from './StoredFilesPanel'
import { StoredModelsPanel } from './StoredModelsPanel'
import { StoredStatsPanel } from './StoredStatsPanel'

type DashboardTab = 'session' | 'saved' | 'stats' | 'logs' | 'console'

interface DashboardViewProps {
  models: ProcessedModel[]
  authenticated: boolean
  hasModels: boolean
  doneCount: number
  onClear: () => void
  onViewDetails: (id: string) => void
  getProgress: (
    id: string,
  ) => ({ stage: ProcessingStage } & ProcessingProgressDetail) | undefined
  queueInfo: QueueInfo | null
  activeProcessingId: string | null
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
  onViewDetails,
  getProgress,
  queueInfo,
  activeProcessingId,
  onLogRefresh,
  consoleLines,
  onClearConsole,
  onCopyConsole,
}: DashboardViewProps) {
  const [activeTab, setActiveTab] = useState<DashboardTab>('session')
  const [searchQuery, setSearchQuery] = useState('')
  const previousDoneCountRef = useRef(0)

  useEffect(() => {
    if (doneCount > 0 && previousDoneCountRef.current === 0) {
      setActiveTab('session')
    }
    previousDoneCountRef.current = doneCount
  }, [doneCount])

  const showSearch = activeTab === 'session' || activeTab === 'saved'

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3 sm:mb-6 sm:gap-4">
        <div>
          <h1 className="mb-1 text-2xl font-semibold text-text-primary max-sm:text-xl">Dashboard</h1>
          <p className="text-base text-text-secondary max-sm:text-sm">
            {doneCount} model{doneCount === 1 ? '' : 's'} in this session
          </p>
        </div>
        {hasModels && activeTab === 'session' ? (
          <button
            type="button"
            onClick={onClear}
            className="rounded border border-border px-3 py-2 text-sm text-text-secondary transition-colors hover:border-border hover:bg-surface-elevated hover:text-text-primary max-sm:w-full"
          >
            Clear session models
          </button>
        ) : null}
      </div>

      <div
        className="mb-5 flex gap-1 overflow-x-auto rounded border border-border bg-surface-elevated/40 p-1 sm:mb-6"
        role="tablist"
        aria-label="Dashboard sections"
      >
        <TabButton
          active={activeTab === 'session'}
          onClick={() => setActiveTab('session')}
          label="Session"
          badge={doneCount > 0 ? doneCount : undefined}
        />
        <TabButton active={activeTab === 'saved'} onClick={() => setActiveTab('saved')} label="Saved" />
        <TabButton active={activeTab === 'stats'} onClick={() => setActiveTab('stats')} label="Stats" />
        <TabButton active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} label="Logs" />
        <TabButton
          active={activeTab === 'console'}
          onClick={() => setActiveTab('console')}
          label="Output"
          badge={consoleLines.length > 0 ? consoleLines.length : undefined}
        />
      </div>

      {showSearch ? (
        <div className="mb-5 sm:mb-6">
          <label className="block">
            <span className="mb-1.5 block text-xs uppercase tracking-wide text-text-secondary">
              Search {activeTab === 'session' ? 'session models' : 'saved library'}
            </span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={activeTab === 'session' ? 'Filter by name, filename…' : 'Filter saved models and files…'}
              className="w-full rounded border border-border bg-surface-base px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-secondary/70 focus:border-accent/50 focus:outline-none"
            />
          </label>
        </div>
      ) : null}

      {activeTab === 'session' ? (
        <div className="space-y-6">
          <section className="rounded border border-border bg-surface-elevated/30 p-3 sm:p-4">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-text-primary">Current Session</h2>
              <p className="mt-1 text-xs text-text-secondary">
                Models extracted in this browser tab. Click a card to view textures, bones, and animations.
              </p>
            </div>
            <StatsBar models={models} />
          </section>

          {hasModels ? (
            <ModelGrid
              models={models}
              searchQuery={searchQuery}
              onViewDetails={onViewDetails}
              getProgress={getProgress}
              queueInfo={queueInfo}
              activeProcessingId={activeProcessingId}
            />
          ) : (
            <div className="rounded border border-border bg-surface-base/60 p-4">
              <p className="text-sm text-text-secondary">
                No models in this session yet. Upload .bbmodel files or a ZIP from the Upload page.
              </p>
            </div>
          )}
        </div>
      ) : null}

      {activeTab === 'saved' ? (
        <div className="space-y-6">
          <section>
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-text-primary">Saved Models</h2>
              <p className="mt-1 text-xs text-text-secondary">
                Models persisted to storage (Supabase + Cloudflare R2).
              </p>
            </div>
            <StoredModelsPanel searchQuery={searchQuery} />
          </section>

          <section>
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-text-primary">Saved Files</h2>
              <p className="mt-1 text-xs text-text-secondary">
                All extracted files grouped by model.
              </p>
            </div>
            <StoredFilesPanel searchQuery={searchQuery} />
          </section>
        </div>
      ) : null}

      {activeTab === 'stats' ? <StoredStatsPanel /> : null}

      {activeTab === 'logs' ? (
        <LogsPanel authenticated={authenticated} onReady={onLogRefresh} />
      ) : null}

      {activeTab === 'console' ? (
        <ConsolePanel lines={consoleLines} onClear={onClearConsole} onCopy={onCopyConsole} />
      ) : null}
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
      role="tab"
      aria-selected={active}
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
