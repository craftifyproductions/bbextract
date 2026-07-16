import { useState } from 'react'

export interface TreeNodeProps {
  id?: string
  label: string
  subtitle?: string
  children?: TreeNodeProps[]
  defaultOpen?: boolean
  depth?: number
  selectedId?: string | null
  onSelect?: (node: TreeNodeProps) => void
}

export function TreeNode({
  id,
  label,
  subtitle,
  children,
  defaultOpen = true,
  depth = 0,
  selectedId,
  onSelect,
}: TreeNodeProps) {
  const [open, setOpen] = useState(defaultOpen)
  const hasChildren = Boolean(children && children.length > 0)
  const selected = Boolean(id && selectedId === id)

  return (
    <li className="tree-item font-mono text-xs">
      <button
        type="button"
        onClick={() => {
          onSelect?.({ id, label, subtitle, children })
          if (hasChildren) setOpen((value) => !value)
        }}
        className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors ${
          selected
            ? 'bg-accent/10 text-text-primary ring-1 ring-accent/30'
            : hasChildren
              ? 'cursor-pointer hover:bg-surface-elevated'
              : 'cursor-pointer hover:bg-surface-elevated/50'
        }`}
        style={{ paddingLeft: `${depth * 4 + 8}px` }}
      >
        {hasChildren ? (
          <span className="w-3 shrink-0 text-accent">{open ? '▾' : '▸'}</span>
        ) : (
          <span className="w-3 shrink-0 text-border">│</span>
        )}
        <span className="truncate text-text-primary">{label}</span>
        {subtitle ? (
          <span className="truncate text-text-secondary">{subtitle}</span>
        ) : null}
      </button>
      {hasChildren && open ? (
        <ul className="tree-branch">
          {children?.map((child, index) => (
            <TreeNode
              key={`${child.label}-${index}`}
              {...child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={child.onSelect ?? onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function TreeRoot({ children }: { children: React.ReactNode }) {
  return <ul className="tree-root">{children}</ul>
}
