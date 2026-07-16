import type { ProcessedModel } from '../../lib/types'
import { DownloadAllButton } from '../export/DownloadButtons'

interface HeaderProps {
  models: ProcessedModel[]
  onClear: () => void
}

export function Header({ models, onClear }: HeaderProps) {
  const doneCount = models.filter((model) => model.status === 'done').length

  return (
    <header className="border-b border-white/10 bg-[#0a0a0f]/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#39ff14]/30 bg-[#39ff14]/10">
              <span className="font-mono text-sm font-bold text-[#39ff14]">BB</span>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-zinc-50">BBExtract</h1>
              <p className="text-sm text-zinc-400">Client-side BBModel extractor</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {doneCount > 1 ? <DownloadAllButton models={models} /> : null}
          {models.length > 0 ? (
            <button
              type="button"
              onClick={onClear}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-400 transition hover:border-white/20 hover:text-zinc-200"
            >
              Clear all
            </button>
          ) : null}
        </div>
      </div>
    </header>
  )
}
