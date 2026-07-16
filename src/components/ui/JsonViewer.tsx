import { useMemo, useState } from 'react'

interface JsonViewerProps {
  data: unknown
  title?: string
}

function colorizeJson(json: string): string {
  return json
    .replace(/("(?:\\.|[^"\\])*")(\s*:)?/g, (_, key, colon) => {
      if (colon) return `<span class="text-accent">${key}</span>${colon}`
      return `<span class="text-accent-warm">${key}</span>`
    })
    .replace(/\b(true|false|null)\b/g, '<span class="text-text-secondary">$1</span>')
    .replace(/\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, '<span class="text-text-primary">$1</span>')
}

export function JsonViewer({ data, title }: JsonViewerProps) {
  const [open, setOpen] = useState(false)

  const coloredJson = useMemo(() => {
    if (!open) return ''
    return colorizeJson(JSON.stringify(data, null, 2))
  }, [data, open])

  return (
    <div className="rounded border border-border bg-surface-base">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-surface-elevated"
      >
        <span>{title ?? 'JSON'}</span>
        <span className="font-mono text-xs text-accent">{open ? '−' : '+'}</span>
      </button>
      {open ? (
        <pre
          className="max-h-80 overflow-auto border-t border-border p-3 font-mono text-xs leading-relaxed text-text-primary"
          dangerouslySetInnerHTML={{ __html: coloredJson }}
        />
      ) : null}
    </div>
  )
}
