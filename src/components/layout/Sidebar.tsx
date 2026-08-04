import { StorageBar } from './StorageBar'

export type AppView = 'upload' | 'dashboard' | 'files' | 'generate' | 'rag'

interface SidebarProps {
  activeView: AppView
  onNavigate: (view: AppView) => void
  modelCount: number
  authenticated?: boolean
  onLogout?: () => void
}

const navItems: { id: AppView; label: string }[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'generate', label: 'Generate' },
  { id: 'rag', label: 'RAG Label' },
  { id: 'files', label: 'Files' },
]

export function Sidebar({
  activeView,
  onNavigate,
  modelCount,
  authenticated = false,
  onLogout,
}: SidebarProps) {
  return (
    <aside className="flex w-[270px] shrink-0 flex-col border-r border-border bg-surface-sidebar max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:w-full max-md:flex-row max-md:items-center max-md:border-r-0 max-md:border-t max-md:bg-surface-sidebar/95 max-md:backdrop-blur">
      <div className="border-b border-border px-5 py-5 max-md:hidden">
        <div className="flex items-center gap-3 max-md:justify-center">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-border bg-surface-elevated">
            <span className="font-mono text-sm font-medium text-accent">BB</span>
          </div>
          <div className="min-w-0 max-md:hidden">
            <p className="text-sm font-semibold tracking-tight text-text-primary">BBExtract</p>
            <p className="text-xs text-text-secondary">BBModel extractor</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 max-md:px-2 max-md:py-2">
        <ul className="space-y-0.5 max-md:grid max-md:grid-cols-5 max-md:gap-1 max-md:space-y-0">
          {navItems.map((item) => {
            const isActive = activeView === item.id
            const showBadge = item.id === 'dashboard' && modelCount > 0
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={`flex w-full items-center gap-3 rounded px-4 py-3 text-left text-base transition-colors max-md:min-h-14 max-md:flex-col max-md:justify-center max-md:gap-1 max-md:px-2 max-md:py-2 max-md:text-[11px] ${
                    isActive
                      ? 'bg-surface-elevated text-text-primary'
                      : 'text-text-secondary hover:bg-surface-elevated/60 hover:text-text-primary'
                  }`}
                  title={item.label}
                >
                  <NavIcon view={item.id} active={isActive} />
                  <span>{item.label}</span>
                  {showBadge ? (
                    <span className="ml-auto rounded border border-border bg-surface-base px-1.5 py-0.5 font-mono text-xs text-text-secondary max-md:hidden">
                      {modelCount}
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      <StorageBar authenticated={authenticated} />

      {authenticated && onLogout ? (
        <div className="border-t border-border px-3 py-4 max-md:hidden">
          <button
            type="button"
            onClick={onLogout}
            className="w-full rounded border border-border px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text-primary"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </aside>
  )
}

function NavIcon({ view, active }: { view: AppView; active: boolean }) {
  const color = active ? 'var(--accent)' : 'var(--text-secondary)'
  if (view === 'upload') {
    return (
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M8 3v7M5 7l3-3 3 3M3 11h10"
          stroke={color}
          strokeWidth="1.25"
          strokeLinecap="square"
        />
      </svg>
    )
  }
  if (view === 'generate') {
    return (
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M8 2v3M8 11v3M2 8h3M11 8h3M4.2 4.2l2.1 2.1M9.7 9.7l2.1 2.1M11.8 4.2l-2.1 2.1M6.3 9.7l-2.1 2.1"
          stroke={color}
          strokeWidth="1.25"
          strokeLinecap="square"
        />
        <circle cx="8" cy="8" r="1.5" stroke={color} strokeWidth="1.25" />
      </svg>
    )
  }
  if (view === 'rag') {
    return (
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M3 12V4h3.5l.8 1.5H13v6.5H3z"
          stroke={color}
          strokeWidth="1.25"
          strokeLinecap="square"
          strokeLinejoin="round"
        />
        <path d="M5.5 8h5M5.5 10h3.5" stroke={color} strokeWidth="1.25" strokeLinecap="square" />
      </svg>
    )
  }
  if (view === 'files') {
    return (
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M2 4.5h4l1 1.5h7v6.5H2z"
          stroke={color}
          strokeWidth="1.25"
          strokeLinecap="square"
          strokeLinejoin="round"
        />
        <path d="M2 4.5V3h4l1 1.5" stroke={color} strokeWidth="1.25" strokeLinecap="square" />
      </svg>
    )
  }

  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="2" width="5" height="5" stroke={color} strokeWidth="1.25" />
      <rect x="9" y="2" width="5" height="5" stroke={color} strokeWidth="1.25" />
      <rect x="2" y="9" width="5" height="5" stroke={color} strokeWidth="1.25" />
      <rect x="9" y="9" width="5" height="5" stroke={color} strokeWidth="1.25" />
    </svg>
  )
}
