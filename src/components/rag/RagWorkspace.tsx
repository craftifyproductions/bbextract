import { useState } from 'react'
import { RagEmbedView } from './RagEmbedView'
import { RagLabelView } from './RagLabelView'

type RagWorkspaceTab = 'label' | 'embed'

const TABS: { id: RagWorkspaceTab; label: string; description: string }[] = [
  {
    id: 'label',
    label: 'Label',
    description: 'Vision-label packs and upload to vector-db',
  },
  {
    id: 'embed',
    label: 'Embed',
    description: 'Index vector-db labels into Supabase pgvector',
  },
]

export function RagWorkspace() {
  const [tab, setTab] = useState<RagWorkspaceTab>('label')

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header>
        <h1 className="mb-1 text-2xl font-semibold text-text-primary max-sm:text-xl">RAG</h1>
        <p className="text-sm text-text-secondary">
          Label Blockbench packs for search, then embed them into your Supabase vector table.
        </p>
      </header>

      <div
        className="flex flex-wrap gap-2 border-b border-border pb-3"
        role="tablist"
        aria-label="RAG workspace"
      >
        {TABS.map((item) => {
          const active = tab === item.id
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.id)}
              className={`rounded px-3 py-2 text-left text-sm transition-colors ${
                active
                  ? 'bg-surface-elevated text-text-primary'
                  : 'text-text-secondary hover:bg-surface-elevated/60 hover:text-text-primary'
              }`}
            >
              <span className="block font-medium">{item.label}</span>
              <span className="mt-0.5 block text-[11px] text-text-secondary">{item.description}</span>
            </button>
          )
        })}
      </div>

      {tab === 'label' ? <RagLabelView /> : <RagEmbedView />}
    </div>
  )
}
