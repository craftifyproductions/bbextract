import { useMemo } from 'react'
import { JsonViewer } from '../ui/JsonViewer'

interface RawDataTabProps {
  rawText?: string
  summary: Record<string, unknown>
}

export function RawDataTab({ rawText, summary }: RawDataTabProps) {
  const raw = useMemo(() => {
    if (!rawText) return {}
    try {
      return JSON.parse(rawText) as Record<string, unknown>
    } catch {
      return { error: 'Failed to parse raw model JSON' }
    }
  }, [rawText])

  return (
    <div className="space-y-4">
      <JsonViewer title="Summary" data={summary} />
      <JsonViewer title="Full Model JSON" data={raw} />
    </div>
  )
}
