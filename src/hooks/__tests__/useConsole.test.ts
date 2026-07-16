import { describe, expect, it } from 'vitest'
import { formatConsoleLine, formatConsoleText, type ConsoleLine } from '../useConsole'

describe('useConsole formatting', () => {
  const sampleLine: ConsoleLine = {
    id: '1',
    timestamp: '2026-07-07T00:00:00.000Z',
    level: 'info',
    message: 'Processing file 1/2: model.bbmodel',
  }

  it('formats a single console line', () => {
    expect(formatConsoleLine(sampleLine)).toBe(
      '[2026-07-07T00:00:00.000Z] [INFO] Processing file 1/2: model.bbmodel',
    )
  })

  it('joins multiple lines for clipboard export', () => {
    const lines: ConsoleLine[] = [
      sampleLine,
      {
        id: '2',
        timestamp: '2026-07-07T00:00:01.000Z',
        level: 'error',
        message: '  Failed: bad.bbmodel — parse error',
      },
    ]

    expect(formatConsoleText(lines)).toBe(
      [
        '[2026-07-07T00:00:00.000Z] [INFO] Processing file 1/2: model.bbmodel',
        '[2026-07-07T00:00:01.000Z] [ERROR]   Failed: bad.bbmodel — parse error',
      ].join('\n'),
    )
  })
})
