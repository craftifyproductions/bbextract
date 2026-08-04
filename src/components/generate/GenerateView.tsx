import { useState } from 'react'
import { Generate2DView } from './Generate2DView'
import { Generate3DView } from './Generate3DView'

type GenerateWorkspace = '3d' | '2d'

const WORKSPACES: { id: GenerateWorkspace; label: string; description: string }[] = [
  {
    id: '3d',
    label: '3D',
    description: 'Models & animations',
  },
  {
    id: '2d',
    label: '2D',
    description: 'UI, icons & art',
  },
]

export function GenerateView() {
  const [workspace, setWorkspace] = useState<GenerateWorkspace>('3d')

  return (
    <div className="space-y-5">
      <header>
        <h1 className="mb-1 text-2xl font-semibold text-text-primary max-sm:text-xl">Generate</h1>
        <p className="max-w-2xl text-base text-text-secondary max-sm:text-sm">
          {workspace === '3d'
            ? 'Create Blockbench-ready 3D models and animations from a reference image and prompt.'
            : 'Create UI screens, icons, sprites, and 2D art assets with AI (Google Gemini).'}
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Generate workspace"
        className="inline-flex rounded border border-border bg-surface-elevated/40 p-1"
      >
        {WORKSPACES.map((item) => {
          const active = workspace === item.id
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setWorkspace(item.id)}
              className={`min-w-[120px] rounded px-3 py-2 text-left transition-colors ${
                active
                  ? 'bg-surface-elevated text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <p className="text-sm font-medium">{item.label}</p>
              <p className="mt-0.5 font-mono text-[10px] text-text-secondary">{item.description}</p>
            </button>
          )
        })}
      </div>

      {workspace === '3d' ? <Generate3DView /> : <Generate2DView />}
    </div>
  )
}
