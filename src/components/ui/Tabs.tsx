import type { ReactNode } from 'react'

interface TabsProps {
  tabs: { id: string; label: string }[]
  activeTab: string
  onChange: (id: string) => void
  children: ReactNode
}

export function Tabs({ tabs, activeTab, onChange, children }: TabsProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 overflow-x-auto border-b border-white/10 pb-px">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`whitespace-nowrap rounded-t-lg px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'border-b-2 border-[#39ff14] bg-white/5 text-[#39ff14]'
                  : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
    </div>
  )
}
