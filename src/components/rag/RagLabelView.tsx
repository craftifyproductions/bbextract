import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { saveAs } from 'file-saver'
import JSZip from 'jszip'
import {
  cancelRagBatch,
  getRagBatchStatus,
  labelLocalUpload,
  startRagBatch,
  syncRagBatchLimits,
  uploadLabeledModelsToVectorDb,
  type LabeledLocalModel,
  type RagBatchState,
} from '../../lib/ragBatchApi'
import { Button } from '../ui/Button'
import { ModelPicker, type ModelPickerGroup } from './ModelPicker'

type RagTab = 'local' | 'batch'

const MODEL_GROUPS: ModelPickerGroup[] = [
  {
    label: 'OpenRouter · top vision',
    ids: ['xiaomi/mimo-v2.5', 'minimax/minimax-m3', 'stepfun/step-3.7-flash'],
  },
  {
    label: 'OpenRouter · Google',
    ids: ['google/gemini-3.6-flash', 'google/gemini-3.5-flash', 'google/gemini-2.5-pro'],
  },
  {
    label: 'OpenRouter · Anthropic',
    ids: ['anthropic/claude-sonnet-5', 'anthropic/claude-sonnet-4.6'],
  },
  {
    label: 'OpenRouter · OpenAI',
    ids: ['openai/gpt-5.4', 'openai/gpt-4.1', 'openai/gpt-4.1-mini', 'openai/gpt-4o'],
  },
  {
    label: 'OpenRouter · Qwen / Meta',
    ids: [
      'qwen/qwen3-vl-235b-a22b-instruct',
      'qwen/qwen2.5-vl-72b-instruct',
      'meta-llama/llama-4-maverick',
      'meta-llama/llama-4-scout',
    ],
  },
  {
    label: 'NVIDIA NIM (direct)',
    ids: [
      'nvidia/nemotron-nano-12b-v2-vl',
      'nvidia/llama-3.1-nemotron-nano-vl-8b-v1',
      'meta/llama-4-scout-17b-16e-instruct',
      'google/gemma-3-27b-it',
    ],
  },
]

export function RagLabelView() {
  const [tab, setTab] = useState<RagTab>('local')
  const [ragState, setRagState] = useState<RagBatchState | null>(null)
  const [ragLimit, setRagLimit] = useState(20)
  const [ragDryRun, setRagDryRun] = useState(false)
  const [ragModel, setRagModel] = useState('google/gemini-3.5-flash')
  const [ragBusy, setRagBusy] = useState(false)
  const [ragError, setRagError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const ragSyncedModelsRef = useRef<Set<string>>(new Set())

  const [dragOver, setDragOver] = useState(false)
  const [localFile, setLocalFile] = useState<File | null>(null)
  const [localBusy, setLocalBusy] = useState(false)
  const [vectorBusy, setVectorBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [localStatus, setLocalStatus] = useState<string | null>(null)
  const [labeledModels, setLabeledModels] = useState<LabeledLocalModel[]>([])
  const [vectorUploaded, setVectorUploaded] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refreshRagStatus = useCallback(async () => {
    try {
      const state = await getRagBatchStatus(ragModel)
      setRagState(state)
      setRagError(null)
      if (state.caps?.maxPerRun && ragLimit > state.caps.maxPerRun) {
        setRagLimit(state.caps.maxPerRun)
      }
      if (state.model && state.status !== 'running' && state.status !== 'cancelling') {
        setRagModel((current) => {
          if (state.availableModels?.some((option) => option.id === current)) return current
          return state.model
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load labeling status'
      if (!/429|too many requests/i.test(message)) setRagError(message)
    }
  }, [ragLimit, ragModel])

  useEffect(() => {
    void refreshRagStatus()
  }, [refreshRagStatus])

  useEffect(() => {
    const active = ragState?.status === 'running' || ragState?.status === 'cancelling'
    const interval = window.setInterval(() => {
      void refreshRagStatus()
    }, active ? 2000 : 8000)
    return () => window.clearInterval(interval)
  }, [ragState?.status, refreshRagStatus])

  const syncLiveLimits = useCallback(async () => {
    setRagBusy(true)
    setRagError(null)
    try {
      const response = await syncRagBatchLimits(ragModel)
      ragSyncedModelsRef.current.add(ragModel)
      setRagState(response.state)
    } catch (err) {
      ragSyncedModelsRef.current.add(ragModel)
      setRagError(err instanceof Error ? err.message : 'Failed to sync live limits')
    } finally {
      setRagBusy(false)
    }
  }, [ragModel])

  const startLabelBatch = useCallback(async () => {
    if (!ragState) return
    const remaining = ragState.rateLimit.rpdRemaining
    const maxAllowed = Math.min(ragLimit, ragState.caps.maxPerRun, remaining)
    if (maxAllowed <= 0) {
      setRagError('Daily OpenRouter label safety limit reached. Try again tomorrow (UTC).')
      return
    }

    const estMinutes = Math.ceil((maxAllowed * 4) / 60)
    const confirmed = window.confirm(
      [
        `Start auto-label for up to ${maxAllowed} model(s) in R2?`,
        '',
        `Model: ${ragModel}`,
        `Limits: ${ragState.caps.rpm} RPM · ${ragState.caps.tpm.toLocaleString()} TPM · ${ragState.caps.rpd} RPD`,
        `Daily remaining: ${remaining}/${ragState.caps.rpd}`,
        `Estimated time: ~${estMinutes} min (paced for safety)`,
        'Writes only to vector-db (not extract folders)',
        'Skips models already labeled in vector-db (model.json + label.json)',
        ragDryRun ? 'Dry run: YES (no upload)' : 'Will upload model.json + label.json + texture into vector-db',
        '',
        'Continue?',
      ].join('\n'),
    )
    if (!confirmed) return

    setRagBusy(true)
    setRagError(null)
    try {
      const response = await startRagBatch({
        limit: maxAllowed,
        dryRun: ragDryRun,
        model: ragModel,
      })
      setRagState(response.state)
      setStatus(response.message)
    } catch (err) {
      setRagError(err instanceof Error ? err.message : 'Failed to start batch')
    } finally {
      setRagBusy(false)
    }
  }, [ragDryRun, ragLimit, ragModel, ragState])

  const cancelLabelBatch = useCallback(async () => {
    setRagBusy(true)
    try {
      const response = await cancelRagBatch()
      setRagState(response.state)
    } catch (err) {
      setRagError(err instanceof Error ? err.message : 'Failed to cancel batch')
    } finally {
      setRagBusy(false)
    }
  }, [])

  const acceptLocalFile = useCallback((file: File | null | undefined) => {
    if (!file) return
    const lower = file.name.toLowerCase()
    if (!lower.endsWith('.zip') && !lower.endsWith('.bbmodel')) {
      setLocalError('Upload a .zip or .bbmodel file')
      setLocalFile(null)
      return
    }
    setLocalError(null)
    setLocalStatus(null)
    setLabeledModels([])
    setVectorUploaded(false)
    setLocalFile(file)
  }, [])

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setDragOver(false)
      acceptLocalFile(event.dataTransfer.files?.[0])
    },
    [acceptLocalFile],
  )

  const runLocalLabel = useCallback(async () => {
    if (!localFile) return
    setLocalBusy(true)
    setLocalError(null)
    setLabeledModels([])
    setVectorUploaded(false)
    setLocalStatus(`Labeling ${localFile.name} with ${ragModel}…`)
    try {
      const result = await labelLocalUpload(localFile, ragModel)
      setLabeledModels(result.models)
      const withTexture = result.models.filter((item) => Boolean(item.texture?.data)).length
      setLocalStatus(
        `Labeled ${result.count} model(s): ${result.models.map((item) => item.name).join(', ')}` +
          ` · texture ${withTexture}/${result.count}. Choose Download or Upload to vector-db.`,
      )
      void refreshRagStatus()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to label upload')
      setLocalStatus(null)
    } finally {
      setLocalBusy(false)
    }
  }, [localFile, ragModel, refreshRagStatus])

  const downloadLabeledZip = useCallback(async () => {
    if (labeledModels.length === 0) return
    setLocalError(null)
    try {
      const zip = new JSZip()
      let textureCount = 0
      for (const item of labeledModels) {
        const root = item.name || 'model'
        zip.file(`${root}/json/model.json`, `${JSON.stringify(item.model, null, 2)}\n`)
        zip.file(`${root}/json/label.json`, `${JSON.stringify(item.label, null, 2)}\n`)
        if (item.texture?.data) {
          const bytes = Uint8Array.from(atob(item.texture.data), (ch) => ch.charCodeAt(0))
          const textureName = item.texture.name || 'texture.png'
          zip.file(`${root}/texture/${textureName}`, bytes)
          textureCount += 1
        }
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const outName =
        (localFile?.name.replace(/\.(zip|bbmodel)$/i, '') || labeledModels[0]?.name || 'rag') +
        '_rag.zip'
      saveAs(blob, outName)
      setLocalStatus(
        textureCount > 0
          ? `Downloaded ${outName} (model.json + label.json + ${textureCount} texture(s))`
          : `Downloaded ${outName} (model.json + label.json; no texture found in source)`,
      )
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to build download zip')
    }
  }, [labeledModels, localFile])

  const uploadLabeledToVector = useCallback(async () => {
    if (labeledModels.length === 0) return
    setVectorBusy(true)
    setLocalError(null)
    const withTexture = labeledModels.filter((item) => Boolean(item.texture?.data)).length
    setLocalStatus(
      withTexture > 0
        ? `Uploading model.json + label.json + texture to vector-db…`
        : `Uploading model.json + label.json to vector-db (no texture found in source)…`,
    )
    try {
      const result = await uploadLabeledModelsToVectorDb(labeledModels)
      setVectorUploaded(result.uploaded.length > 0)
      if (result.failed.length > 0 && result.uploaded.length === 0) {
        setLocalError(result.failed.map((item) => `${item.name}: ${item.error}`).join('; '))
        setLocalStatus(null)
      } else {
        setLocalStatus(
          `${result.message}${withTexture === 0 ? ' · warning: no texture was available to upload' : ''}`,
        )
        if (result.failed.length > 0) {
          setLocalError(
            `Some uploads failed: ${result.failed.map((item) => `${item.name}: ${item.error}`).join('; ')}`,
          )
        }
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to upload to vector-db')
      setLocalStatus(null)
    } finally {
      setVectorBusy(false)
    }
  }, [labeledModels])

  const modelSelect = (
    <ModelPicker
      value={ragModel}
      groups={MODEL_GROUPS}
      options={ragState?.availableModels ?? []}
      disabled={
        localBusy ||
        ragBusy ||
        ragState?.status === 'running' ||
        ragState?.status === 'cancelling'
      }
      onChange={setRagModel}
      fallbackLabel="Gemini 3.5 Flash"
    />
  )

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <h1 className="mb-1 text-2xl font-semibold text-text-primary max-sm:text-xl">RAG Label</h1>
        <p className="text-base text-text-secondary max-sm:text-sm">
          Generate <span className="font-mono">model.json</span> + AI{' '}
          <span className="font-mono">label.json</span> from a local file, or batch-label models already
          in R2.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="RAG label modes">
        <Button
          variant={tab === 'local' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setTab('local')}
        >
          Local upload
        </Button>
        <Button
          variant={tab === 'batch' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setTab('batch')}
        >
          R2 batch auto-label
        </Button>
      </div>

      {tab === 'local' ? (
        <div className="rounded border border-border bg-surface-elevated/30 p-3 sm:p-4">
          <h2 className="text-sm font-semibold text-text-primary">Label a local file</h2>
          <p className="mt-1 text-xs text-text-secondary">
            Drag & drop a <span className="font-mono">.zip</span> (with .bbmodel inside) or a single{' '}
            <span className="font-mono">.bbmodel</span>. Click <span className="font-mono">Label</span>, then
            choose Download or Upload to vector-db.
          </p>

          <div className="mt-3 flex flex-wrap items-end gap-3">{modelSelect}</div>
          {ragState &&
          ragState.availableModels?.find((m) => m.id === ragModel)?.provider === 'nvidia' &&
          !ragState.providers?.nvidia ? (
            <p className="mt-2 text-xs text-amber-300">
              Add <span className="font-mono">NVIDIA_API_KEY</span> to your{' '}
              <span className="font-mono">.env</span> and restart the server.
            </p>
          ) : ragState &&
            ragState.availableModels?.find((m) => m.id === ragModel)?.provider !== 'nvidia' &&
            !ragState.providers?.openrouter ? (
            <p className="mt-2 text-xs text-amber-300">
              Add <span className="font-mono">OPENROUTER_API_KEY</span> to your{' '}
              <span className="font-mono">.env</span> and restart the server.
            </p>
          ) : null}

          <div
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click()
            }}
            onDragEnter={(event) => {
              event.preventDefault()
              setDragOver(true)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={(event) => {
              event.preventDefault()
              setDragOver(false)
            }}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`mt-4 flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded border border-dashed px-4 py-8 text-center transition-colors ${
              dragOver
                ? 'border-accent bg-accent/10'
                : 'border-border bg-surface-base/40 hover:border-accent/50'
            }`}
          >
            <p className="text-sm font-medium text-text-primary">
              {localFile ? localFile.name : 'Drop .zip or .bbmodel here'}
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              {localFile
                ? `${(localFile.size / 1024).toFixed(1)} KB · click to change`
                : 'or click to browse · up to 80 MB · max 10 models per zip'}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,.bbmodel,application/zip"
              className="hidden"
              onChange={(event) => acceptLocalFile(event.target.files?.[0])}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={!localFile || localBusy || vectorBusy || !ragState?.configured}
              onClick={() => void runLocalLabel()}
            >
              {localBusy ? 'Labeling…' : 'Label'}
            </Button>
            {localFile ? (
              <Button
                variant="ghost"
                disabled={localBusy || vectorBusy}
                onClick={() => {
                  setLocalFile(null)
                  setLabeledModels([])
                  setVectorUploaded(false)
                  setLocalStatus(null)
                  setLocalError(null)
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>

          {labeledModels.length > 0 ? (
            <div className="mt-4 rounded border border-border bg-surface-base/40 p-3">
              <p className="text-xs font-medium text-text-primary">
                Labeled {labeledModels.length} model(s)
              </p>
              <ul className="mt-2 space-y-1 font-mono text-[11px] text-text-secondary">
                {labeledModels.map((item) => (
                  <li key={item.name}>
                    {item.name} → {String(item.label.category ?? '—')}
                    {item.label.subcategory ? ` / ${String(item.label.subcategory)}` : ''}
                    {item.label.complexity ? ` · ${String(item.label.complexity)}` : ''}
                    {item.label.needs_review ? ' · needs review' : ''}
                    {item.texture?.data ? ' · texture ✓' : ' · no texture'}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={localBusy || vectorBusy}
                  onClick={() => void downloadLabeledZip()}
                >
                  Download
                </Button>
                <Button
                  variant="primary"
                  disabled={localBusy || vectorBusy}
                  onClick={() => void uploadLabeledToVector()}
                >
                  {vectorBusy
                    ? 'Uploading…'
                    : vectorUploaded
                      ? 'Uploaded to vector-db'
                      : 'Upload to vector-db'}
                </Button>
              </div>
            </div>
          ) : null}

          {localStatus ? (
            <p className="mt-3 font-mono text-[11px] text-emerald-300">{localStatus}</p>
          ) : null}
          {localError ? <p className="mt-2 text-xs text-red-300">{localError}</p> : null}
        </div>
      ) : (
        <div className="rounded border border-border bg-surface-elevated/30 p-3 sm:p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">R2 batch auto-label</h2>
              <p className="mt-1 text-xs text-text-secondary">
                Scans extract storage for models, labels them, and writes the clean corpus into
                vector-db only (never re-labels packs that already have model.json + label.json).
              </p>
            </div>
            {ragState?.status === 'running' || ragState?.status === 'cancelling' ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={ragBusy || ragState.status === 'cancelling'}
                onClick={() => void cancelLabelBatch()}
              >
                {ragState.status === 'cancelling' ? 'Cancelling…' : 'Cancel batch'}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                disabled={ragBusy || !ragState?.configured}
                onClick={() => void syncLiveLimits()}
              >
                Sync live limits
              </Button>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            {modelSelect}
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              Max models
              <input
                type="number"
                min={1}
                max={ragState?.caps.maxPerRun ?? 100}
                value={ragLimit}
                disabled={ragState?.status === 'running' || ragState?.status === 'cancelling'}
                onChange={(event) => setRagLimit(Number(event.target.value) || 1)}
                className="w-20 rounded border border-border bg-surface-base px-2 py-1 font-mono text-xs text-text-primary"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={ragDryRun}
                disabled={ragState?.status === 'running' || ragState?.status === 'cancelling'}
                onChange={(event) => setRagDryRun(event.target.checked)}
              />
              Dry run (no upload)
            </label>
            <Button
              variant="primary"
              disabled={
                ragBusy ||
                !ragState?.configured ||
                ragState.status === 'running' ||
                ragState.status === 'cancelling'
              }
              onClick={() => void startLabelBatch()}
            >
              Start batch
            </Button>
          </div>

          {ragState ? (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-[11px] text-text-secondary">
                  Limits for <span className="text-text-primary">{ragModel}</span> · updated{' '}
                  {new Date(ragState.rateLimit.updatedAt || Date.now()).toLocaleTimeString()}
                </p>
                <p
                  className={`font-mono text-[11px] ${
                    ragState.rateLimit.liveSynced ? 'text-sky-300' : 'text-text-secondary'
                  }`}
                >
                  {ragState.rateLimit.liveSynced
                    ? 'Source: live provider headers'
                    : 'Source: OpenRouter local safety caps'}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <RateMeter
                  title="RPM (per minute)"
                  used={ragState.rateLimit.rpmUsed}
                  limit={ragState.rateLimit.rpmLimit}
                  remaining={ragState.rateLimit.rpmRemaining}
                  percent={ragState.rateLimit.rpmPercent}
                  detail={
                    ragState.rateLimit.rpmResetsInSeconds > 0
                      ? `window frees in ~${ragState.rateLimit.rpmResetsInSeconds}s`
                      : 'window clear'
                  }
                />
                <RateMeter
                  title="TPM (tokens / min)"
                  used={ragState.rateLimit.tpmUsed}
                  limit={ragState.rateLimit.tpmLimit}
                  remaining={ragState.rateLimit.tpmRemaining}
                  percent={ragState.rateLimit.tpmPercent}
                  detail={
                    (ragState.rateLimit.tpmResetsInSeconds ?? 0) > 0
                      ? `refills in ~${ragState.rateLimit.tpmResetsInSeconds}s · ${ragState.rateLimit.tpmUsed.toLocaleString()} used`
                      : `${ragState.rateLimit.tpmUsed.toLocaleString()} used · window clear`
                  }
                />
                <RateMeter
                  title="RPD (per day UTC)"
                  used={ragState.rateLimit.rpdUsed}
                  limit={ragState.rateLimit.rpdLimit}
                  remaining={ragState.rateLimit.rpdRemaining}
                  percent={ragState.rateLimit.rpdPercent}
                  detail={`date ${ragState.rateLimit.date}`}
                />
              </div>

              <div className="grid gap-2 font-mono text-[11px] text-text-secondary sm:grid-cols-2">
                <p>
                  Status: <span className="text-text-primary">{ragState.status}</span>
                  {ragState.currentModel ? ` · ${ragState.currentModel}` : ''}
                </p>
                <p>
                  Progress: {ragState.completed} done / {ragState.skipped} skipped / {ragState.failed}{' '}
                  failed · total {ragState.total}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-3 font-mono text-[11px] text-text-secondary">Loading labeling status…</p>
          )}

          {status ? <p className="mt-2 font-mono text-[11px] text-text-secondary">{status}</p> : null}
          {ragError ? <p className="mt-2 text-xs text-red-300">{ragError}</p> : null}
          {ragState?.lastError ? (
            <p className="mt-2 text-xs text-red-300">Last error: {ragState.lastError}</p>
          ) : null}

          {ragState?.logs?.length ? (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary/70">
                  Console
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const text = ragState.logs
                      .map((log) => `[${log.level}] ${log.message}`)
                      .join('\n')
                    void navigator.clipboard.writeText(text).then(
                      () => setStatus('RAG console copied to clipboard.'),
                      () => setRagError('Could not copy console text'),
                    )
                  }}
                >
                  Copy
                </Button>
              </div>
              <div className="max-h-80 overflow-y-auto rounded border border-border bg-surface-base/50 p-2">
                {ragState.logs.slice(-40).map((log, i) => (
                  <pre
                    key={`${log.at}-${i}`}
                    className={`mb-2 whitespace-pre-wrap break-words font-mono text-[10px] last:mb-0 ${
                      log.level === 'error'
                        ? 'text-red-300'
                        : log.level === 'warn'
                          ? 'text-amber-300'
                          : 'text-text-secondary'
                    }`}
                  >
                    {log.message}
                  </pre>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

function RateMeter({
  title,
  used,
  limit,
  remaining,
  percent,
  detail,
}: {
  title: string
  used: number
  limit: number
  remaining: number
  percent: number
  detail: string
}) {
  const tone =
    percent >= 90 ? 'bg-red-400' : percent >= 70 ? 'bg-amber-400' : 'bg-emerald-400'

  return (
    <div className="rounded border border-border bg-surface-base/50 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-text-primary">{title}</p>
        <p className="font-mono text-[10px] text-text-secondary">
          {used.toLocaleString()}/{limit.toLocaleString()}
        </p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-surface-elevated">
        <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <p className="mt-1.5 font-mono text-[10px] text-text-secondary">
        {remaining.toLocaleString()} left · {detail}
      </p>
    </div>
  )
}
