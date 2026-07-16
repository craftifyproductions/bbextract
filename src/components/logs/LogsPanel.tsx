import { useCallback, useEffect, useState } from 'react'
import { listAuditEvents, recordAuditEvent, type AuditEvent } from '../../lib/auditLogStore'
import {
  downloadSessionLog,
  downloadSessionLogById,
  getSessionLog,
  listSessionLogs,
} from '../../lib/logStore'
import { isSupabaseConfigured } from '../../lib/envSettings'
import type { SessionLogRecord } from '../../lib/sessionLogger'
import { Button } from '../ui/Button'

interface LogsPanelProps {
  onReady?: (refresh: () => void) => void
  authenticated: boolean
}

export function LogsPanel({ onReady, authenticated }: LogsPanelProps) {
  const [logs, setLogs] = useState<SessionLogRecord[]>([])
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loadingContentId, setLoadingContentId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const entries = await listSessionLogs(authenticated)
      setLogs(entries)
      setAuditEvents(await listAuditEvents())
    } catch (err) {
      console.error('[BBExtract] Failed to load logs:', err)
    } finally {
      setLoading(false)
    }
  }, [authenticated])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    onReady?.(refresh)
  }, [onReady, refresh])

  const toggleExpand = useCallback(
    async (log: SessionLogRecord) => {
      if (expandedId === log.id) {
        setExpandedId(null)
        return
      }

      setExpandedId(log.id)

      if (!log.content) {
        setLoadingContentId(log.id)
        try {
          const full = await getSessionLog(log.id, authenticated)
          if (full?.content) {
            setLogs((prev) =>
              prev.map((entry) => (entry.id === log.id ? { ...entry, content: full.content } : entry)),
            )
          }
        } catch (err) {
          console.error('[BBExtract] Failed to load log content:', err)
        } finally {
          setLoadingContentId(null)
        }
      }
    },
    [authenticated, expandedId],
  )

  const storageHint = isSupabaseConfigured()
    ? 'Logs are saved to your account and kept locally in this browser. Expand a run to view details.'
    : authenticated
      ? 'Logs are saved on the server and in this browser. Expand a run to view the full log.'
      : 'Logs are saved in this browser. Sign in to sync logs.'

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-2xl text-sm leading-relaxed text-text-secondary">{storageHint}</p>
        <Button variant="secondary" size="sm" onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>

      <div className="mb-8 rounded-lg border border-border bg-surface-elevated">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Recent User Activity</h2>
          <p className="mt-1 text-xs text-text-secondary">
            Short log of uploads, storage syncs, and downloads.
          </p>
        </div>
        {auditEvents.length === 0 ? (
          <p className="px-4 py-4 text-sm text-text-secondary">No user activity logged yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {auditEvents.map((event) => (
              <li key={event.id} className="px-4 py-3">
                <p className="font-mono text-xs text-text-primary">
                  {new Date(event.createdAt).toLocaleString()} · {event.userEmail ?? 'unknown user'}
                </p>
                <p className="mt-1 text-sm text-text-secondary">
                  {formatAction(event.action)}
                  {event.subject ? ` — ${event.subject}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {loading ? (
        <p className="font-mono text-sm text-text-secondary">Loading logs…</p>
      ) : logs.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface-elevated px-6 py-12 text-center">
          <p className="text-sm text-text-secondary">No extraction runs logged yet.</p>
          <p className="mt-2 font-mono text-xs text-text-secondary">
            Upload .bbmodel files — each batch is logged automatically with timestamps and model counts.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-elevated">
          {logs.map((log) => {
            const expanded = expandedId === log.id
            const loadingContent = loadingContentId === log.id

            return (
              <li key={log.id}>
                <button
                  type="button"
                  onClick={() => void toggleExpand(log)}
                  className="flex w-full flex-wrap items-center justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-surface-base/40"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <Chevron expanded={expanded} />
                    <div className="min-w-0">
                      <p className="font-mono text-sm text-text-primary">
                        {new Date(log.createdAt).toLocaleString()}
                      </p>
                      <p className="mt-1 font-mono text-xs text-text-secondary">
                        {log.userEmail ? (
                          <>
                            User: <span className="text-accent">{log.userEmail}</span> ·{' '}
                          </>
                        ) : null}
                        {log.fileCount} model{log.fileCount === 1 ? '' : 's'} ·{' '}
                        <span className="text-emerald-400">{log.successCount} ok</span>
                        {log.errorCount > 0 ? (
                          <>
                            {' '}
                            · <span className="text-red-400">{log.errorCount} failed</span>
                          </>
                        ) : null}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-xs text-text-secondary/70">
                        {log.filename}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (log.content) {
                          downloadSessionLog(log)
                          void recordAuditEvent('downloaded_session_log', log.filename, {
                            runId: log.id,
                          })
                        } else {
                          void downloadSessionLogById(log.id, log.filename, authenticated).then(() =>
                            recordAuditEvent('downloaded_session_log', log.filename, {
                              runId: log.id,
                            }),
                          )
                        }
                      }}
                    >
                      Download
                    </Button>
                  </div>
                </button>

                {expanded ? (
                  <div className="border-t border-border bg-surface-base/50 px-4 py-4">
                    {loadingContent ? (
                      <p className="font-mono text-xs text-text-secondary">Loading log content…</p>
                    ) : log.content ? (
                      <pre className="max-h-96 overflow-auto rounded border border-border bg-surface-base p-4 font-mono text-xs leading-relaxed text-text-secondary whitespace-pre-wrap">
                        {log.content}
                      </pre>
                    ) : (
                      <p className="font-mono text-xs text-text-secondary">
                        Log content unavailable. Try refreshing or downloading.
                      </p>
                    )}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function formatAction(action: string): string {
  return action
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={`mt-0.5 shrink-0 text-text-secondary transition-transform ${expanded ? 'rotate-90' : ''}`}
      aria-hidden
    >
      <path
        d="M6 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
