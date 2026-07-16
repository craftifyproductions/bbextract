import type { ReactNode } from 'react'
import { Footer } from './Footer'
import { Sidebar, type AppView } from './Sidebar'

interface AppShellProps {
  activeView: AppView
  onNavigate: (view: AppView) => void
  modelCount: number
  authenticated?: boolean
  onLogout?: () => void
  banner?: ReactNode
  children: ReactNode
}

export function AppShell({
  activeView,
  onNavigate,
  modelCount,
  authenticated = false,
  onLogout,
  banner,
  children,
}: AppShellProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-surface-base max-md:flex-col">
      <Sidebar
        activeView={activeView}
        onNavigate={onNavigate}
        modelCount={modelCount}
        authenticated={authenticated}
        onLogout={onLogout}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {banner}
        <main className="min-h-0 flex-1 overflow-auto px-10 py-10 max-lg:px-6 max-md:px-4 max-md:py-5 max-md:pb-24">
          {children}
        </main>
        <div className="max-md:hidden">
          <Footer />
        </div>
      </div>
    </div>
  )
}
