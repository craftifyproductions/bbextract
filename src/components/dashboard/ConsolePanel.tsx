import { useEffect, useRef } from 'react'
import type { ConsoleLine } from '../../hooks/useConsole'
import { formatConsoleLine } from '../../hooks/useConsole'
import { Button } from '../ui/Button'

interface ConsolePanelProps {
  lines: ConsoleLine[]
  onClear: () => void
  onCopy: () => void
}

const levelClasses: Record<ConsoleLine['level'], string> = {
  info: 'text-text-primary',
  warn: 'text-yellow-400',
  error: 'text-red-400',
  debug: 'text-text-secondary',
}

export function ConsolePanel({ lines, onClear, onCopy }: ConsolePanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [lines])

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-base text-text-secondary">
          Live extraction output for the current browser session.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onCopy} disabled={lines.length === 0}>
            Copy logs
          </Button>
          <Button variant="secondary" size="sm" onClick={onClear} disabled={lines.length === 0}>
            Clear console
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="max-h-[min(28rem,60vh)] overflow-y-auto rounded border border-border bg-[#0f1115] p-4 font-mono text-xs leading-relaxed shadow-inner"
      >
        {lines.length === 0 ? (
          <p className="text-text-secondary">
            Console output will appear here when files are processed.
          </p>
        ) : (
          <div className="space-y-1">
            {lines.map((line) => (
              <div key={line.id} className={`whitespace-pre-wrap break-words ${levelClasses[line.level]}`}>
                {formatConsoleLine(line)}
              </div>
            ))}
            <div ref={bottomRef} aria-hidden="true" />
          </div>
        )}
      </div>
    </section>
  )
}
