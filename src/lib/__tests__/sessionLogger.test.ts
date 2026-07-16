import { describe, expect, it } from 'vitest'
import { createSessionLogger, formatLogFilename } from '../sessionLogger'
import { selectLogsToDelete, selectLogsToKeep, mergeSessionLogLists } from '../logStore'

describe('sessionLogger', () => {
  it('records batch lifecycle', () => {
    const logger = createSessionLogger()
    logger.startBatch([new File(['{}'], 'test.bbmodel', { type: 'application/json' })])
    logger.fileStart('test.bbmodel', 1, 1)
    logger.fileProgress('test.bbmodel', 'parsing')
    logger.fileSuccess('test.bbmodel', {
      elements: 4,
      bones: 2,
      textures: 1,
      animations: 0,
      extractedBytes: 1024,
    })

    const record = logger.finish()
    expect(record.fileCount).toBe(1)
    expect(record.successCount).toBe(1)
    expect(record.errorCount).toBe(0)
    expect(record.content).toContain('Upload batch started')
    expect(record.content).toContain('Completed: test.bbmodel')
    expect(record.filename).toMatch(/^bbextract-/)
  })

  it('formatLogFilename strips unsafe characters', () => {
    expect(formatLogFilename('2026-07-07T00:11:30.123Z')).toBe(
      'bbextract-2026-07-07T00-11-30-123Z.log',
    )
  })
})

describe('logStore rotation', () => {
  it('keeps only the latest 5 logs', () => {
    const logs = Array.from({ length: 7 }, (_, i) => ({
      id: String(i),
      filename: `log-${i}.log`,
      createdAt: `2026-07-0${i + 1}T00:00:00.000Z`,
      fileCount: 1,
      successCount: 1,
      errorCount: 0,
      content: '',
    }))

    const keep = selectLogsToKeep(logs, 5)
    expect(keep).toHaveLength(5)
    expect(keep[0].id).toBe('6')
    expect(keep[4].id).toBe('2')
  })

  it('selects stale logs for deletion', () => {
    const logs = Array.from({ length: 6 }, (_, i) => ({
      id: String(i),
      filename: `log-${i}.log`,
      createdAt: `2026-07-0${i + 1}T00:00:00.000Z`,
      fileCount: 1,
      successCount: 1,
      errorCount: 0,
      content: '',
    }))

    const keep = selectLogsToKeep(logs, 5)
    const remove = selectLogsToDelete(logs, keep)
    expect(remove).toHaveLength(1)
    expect(remove[0].id).toBe('0')
  })

  it('merges server and local logs without losing local content', () => {
    const localLogs = [
      {
        id: 'local-1',
        filename: 'local.log',
        createdAt: '2026-07-07T12:00:00.000Z',
        fileCount: 1,
        successCount: 1,
        errorCount: 0,
        content: 'local content',
      },
    ]

    const serverLogs = [
      {
        id: 'server-1',
        filename: 'server.log',
        createdAt: '2026-07-08T12:00:00.000Z',
        fileCount: 2,
        successCount: 2,
        errorCount: 0,
        content: '',
      },
    ]

    const merged = mergeSessionLogLists(serverLogs, localLogs)
    expect(merged).toHaveLength(2)
    expect(merged.find((log) => log.id === 'local-1')?.content).toBe('local content')
  })
})
