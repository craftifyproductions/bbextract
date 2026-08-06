import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cancelEmbedJob,
  getEmbedStatus,
  searchEmbeddedModels,
  setAutoEmbedEnabled,
  startEmbedJob,
  type EmbedJobState,
  type EmbedModelOption,
  type EmbedSearchMatch,
} from '../../lib/ragEmbedApi'
import { Button } from '../ui/Button'
import { ProviderIcon, providerLabelForModel } from './ModelPicker'

const DEFAULT_EMBED_MODEL = 'openai/text-embedding-3-small'
const MODEL_EXAMPLES =
  'openai/text-embedding-3-small · qwen/qwen3-embedding-8b · google/gemini-embedding-001'

function humanizeModelId(modelId: string): string {
  const leaf = modelId.split('/').pop() || modelId
  return leaf
    .replace(/:free$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function resolveEmbedModelInfo(
  modelId: string,
  catalog: EmbedModelOption[] | undefined,
): EmbedModelOption {
  const found = catalog?.find((option) => option.id === modelId)
  if (found) return found
  return {
    id: modelId,
    label: humanizeModelId(modelId),
    hint: 'Custom OpenRouter embedding model · must return 1536 dims',
    provider: modelId.startsWith('nvidia/nv-') ? 'nvidia' : 'openrouter',
    priceLabel: modelId.includes(':free') ? 'Free' : undefined,
  }
}

function isValidEmbedModelId(value: string): boolean {
  return value.includes('/')
}

export function RagEmbedView() {
  const [state, setState] = useState<EmbedJobState | null>(null)
  const [model, setModel] = useState(DEFAULT_EMBED_MODEL)
  const [modelEditing, setModelEditing] = useState(false)
  const [draftModel, setDraftModel] = useState(DEFAULT_EMBED_MODEL)
  const modelInputRef = useRef<HTMLInputElement>(null)
  const [limit, setLimit] = useState(20)
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchBusy, setSearchBusy] = useState(false)
  const [matches, setMatches] = useState<EmbedSearchMatch[]>([])

  const refresh = useCallback(async () => {
    try {
      const next = await getEmbedStatus(model.trim() || DEFAULT_EMBED_MODEL)
      setState(next)
      setError(null)
      if (next.maxPerRun && limit > next.maxPerRun) setLimit(next.maxPerRun)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load embed status')
    }
  }, [limit, model])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const active = state?.status === 'running' || state?.status === 'cancelling'
    const interval = window.setInterval(() => {
      void refresh()
    }, active ? 1500 : 8000)
    return () => window.clearInterval(interval)
  }, [refresh, state?.status])

  const resolvedModel = model.trim() || DEFAULT_EMBED_MODEL
  const modelInfo = useMemo(
    () => resolveEmbedModelInfo(resolvedModel, state?.availableModels),
    [resolvedModel, state?.availableModels],
  )
  const modelLooksValid = isValidEmbedModelId(resolvedModel)
  const draftLooksValid = isValidEmbedModelId(draftModel.trim())
  const running = state?.status === 'running' || state?.status === 'cancelling'

  useEffect(() => {
    if (!modelEditing) return
    const frame = window.requestAnimationFrame(() => {
      const input = modelInputRef.current
      if (!input) return
      input.focus()
      input.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [modelEditing])

  const beginEditModel = () => {
    if (busy || running) return
    setDraftModel(resolvedModel)
    setModelEditing(true)
    setError(null)
  }

  const cancelEditModel = () => {
    setDraftModel(resolvedModel)
    setModelEditing(false)
    setError(null)
  }

  const confirmModel = () => {
    const next = draftModel.trim()
    if (!isValidEmbedModelId(next)) {
      setError('Enter a full OpenRouter model id, e.g. openai/text-embedding-3-small')
      return
    }
    setModel(next)
    setModelEditing(false)
    setError(null)
    setStatus(`Embedding model set to ${next}`)
  }

  const toggleAutoEmbed = async (enabled: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const response = await setAutoEmbedEnabled(enabled)
      setState(response.state)
      setStatus(
        response.autoEmbedEnabled
          ? 'Auto-embed after labeling: ON'
          : 'Auto-embed after labeling: OFF',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update auto-embed')
    } finally {
      setBusy(false)
    }
  }

  const startJob = async () => {
    if (!state?.configured) {
      setError('Configure OPENROUTER_API_KEY, SUPABASE_SERVICE_ROLE_KEY, and R2 vector-db first.')
      return
    }
    if (!modelLooksValid) {
      setError('Enter a full OpenRouter model id, e.g. openai/text-embedding-3-small')
      return
    }
    const maxAllowed = Math.min(limit, state.maxPerRun)
    const ok = window.confirm(
      [
        `Embed up to ${maxAllowed} vector-db pack(s)?`,
        `Model: ${resolvedModel}`,
        `Dims: ${state.embeddingDims} (model must return this size)`,
        force ? 'Force re-embed: YES (overwrite existing)' : 'Skip already embedded: YES',
        `Packs in R2: ${state.packCount ?? '—'} · Indexed rows: ${state.indexedCount ?? '—'}`,
        state.rateLimit
          ? `Safety: ${state.rateLimit.rpmLimit} RPM · ${state.rateLimit.tpmLimit.toLocaleString()} TPM · ${state.rateLimit.rpdRemaining}/${state.rateLimit.rpdLimit} RPD left`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    if (!ok) return

    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const response = await startEmbedJob({ model: resolvedModel, limit: maxAllowed, force })
      setState(response.state)
      setStatus('Embedding job started')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start embedding')
    } finally {
      setBusy(false)
    }
  }

  const cancelJob = async () => {
    setBusy(true)
    try {
      const response = await cancelEmbedJob()
      setState(response.state)
      setStatus('Cancel requested')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel')
    } finally {
      setBusy(false)
    }
  }

  const runSearch = async () => {
    if (!searchQuery.trim()) return
    setSearchBusy(true)
    setError(null)
    try {
      const response = await searchEmbeddedModels({
        query: searchQuery.trim(),
        model: resolvedModel,
        limit: 5,
      })
      setMatches(response.matches)
      setStatus(`Search with ${response.model}: ${response.matches.length} match(es)`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setSearchBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded border border-border bg-surface-elevated/40 p-4">
        <h2 className="text-sm font-semibold text-text-primary">Embed vector-db → Supabase</h2>
        <p className="mt-1 text-xs text-text-secondary">
          Reads each pack&apos;s <span className="font-mono">label.json</span> from R2{' '}
          <span className="font-mono">vector-db</span>, embeds{' '}
          <span className="font-mono">embedding_text</span>, and upserts into{' '}
          <span className="font-mono">rag_models</span>. Already-embedded packs are skipped unless
          Force re-embed is on. Paste any OpenRouter embedding model id (must return{' '}
          {state?.embeddingDims ?? 1536} dims).
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex min-w-[280px] flex-1 flex-col gap-1.5 sm:max-w-xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-secondary">
              Embedding model
            </p>

            {modelEditing ? (
              <div
                className={`rounded-lg border bg-surface-base/80 transition-all duration-200 ${
                  draftLooksValid
                    ? 'border-accent/55 shadow-[0_0_0_1px_rgba(74,127,212,0.18)]'
                    : 'border-border focus-within:border-accent/40'
                }`}
              >
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-elevated text-[11px] font-mono text-text-secondary">
                    ID
                  </span>
                  <input
                    ref={modelInputRef}
                    type="text"
                    value={draftModel}
                    disabled={busy || running}
                    spellCheck={false}
                    placeholder="openai/text-embedding-3-small"
                    onChange={(event) => setDraftModel(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        confirmModel()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelEditModel()
                      }
                    }}
                    onBlur={() => {
                      if (draftLooksValid) confirmModel()
                    }}
                    className="min-w-0 flex-1 bg-transparent font-mono text-sm text-text-primary outline-none placeholder:text-text-secondary/50"
                  />
                  <kbd className="hidden shrink-0 rounded border border-border bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-text-secondary sm:inline">
                    Enter
                  </kbd>
                </div>
                <p className="border-t border-border/70 px-3 py-1.5 font-mono text-[10px] text-text-secondary/80">
                  Paste provider/model-id · {MODEL_EXAMPLES.split(' · ')[0]}…
                </p>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy || running}
                title="Double-click to edit model id"
                onDoubleClick={beginEditModel}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    beginEditModel()
                  }
                }}
                className={`group flex w-full items-start gap-3 rounded-lg border border-border bg-surface-base/80 px-3 py-2.5 text-left transition-all duration-200 ${
                  busy || running
                    ? 'cursor-not-allowed opacity-50'
                    : 'cursor-pointer hover:border-accent/35 hover:bg-surface-elevated/80'
                }`}
              >
                <ProviderIcon modelId={resolvedModel} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="break-all text-sm font-medium text-text-primary">
                      {modelInfo.label}
                    </span>
                    {resolvedModel.includes(':free') || modelInfo.priceLabel === 'Free' ? (
                      <span className="rounded bg-accent-warm/15 px-1.5 py-0.5 font-mono text-[10px] text-accent-warm">
                        free
                      </span>
                    ) : modelInfo.priceLabel ? (
                      <span className="rounded bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                        {modelInfo.priceLabel}
                      </span>
                    ) : null}
                    <span className="rounded bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                      {providerLabelForModel(resolvedModel)}
                    </span>
                  </span>
                  <span className="mt-1 block break-all font-mono text-[10px] leading-relaxed text-text-secondary">
                    {modelInfo.id}
                  </span>
                  {modelInfo.hint ? (
                    <span className="mt-0.5 block text-[11px] leading-snug text-text-secondary/90">
                      {modelInfo.hint}
                    </span>
                  ) : null}
                </span>
              </button>
            )}

            {modelEditing && draftModel.trim() && !draftLooksValid ? (
              <p className="text-xs text-amber-300">
                Use a full model id like <span className="font-mono">provider/model-name</span>
              </p>
            ) : null}
            {!modelEditing && !modelLooksValid ? (
              <p className="text-xs text-amber-300">Invalid model id — double-click to fix.</p>
            ) : null}
          </div>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Limit
            <input
              type="number"
              min={1}
              max={state?.maxPerRun ?? 500}
              value={limit}
              disabled={busy || running}
              onChange={(event) => setLimit(Number(event.target.value) || 1)}
              className="w-24 rounded border border-border bg-surface-base px-2 py-2 font-mono text-sm text-text-primary"
            />
          </label>
          <label className="mb-2 flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={force}
              disabled={busy || running}
              onChange={(event) => setForce(event.target.checked)}
            />
            Force re-embed
          </label>
          <label className="mb-2 flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={state?.autoEmbedEnabled !== false}
              disabled={busy || running}
              onChange={(event) => void toggleAutoEmbed(event.target.checked)}
            />
            Auto-embed after labeling
          </label>
          <Button
            variant="primary"
            disabled={busy || running || !state?.configured || modelEditing}
            onClick={() => void startJob()}
          >
            Start embed
          </Button>
          <Button variant="ghost" disabled={busy || !running} onClick={() => void cancelJob()}>
            Cancel
          </Button>
        </div>

        {!state?.providers.openrouter ? (
          <p className="mt-2 text-xs text-amber-300">
            Add <span className="font-mono">OPENROUTER_API_KEY</span> for OpenRouter embed models.
          </p>
        ) : null}
        {state && !state.providers.supabaseService ? (
          <p className="mt-2 text-xs text-amber-300">
            Add <span className="font-mono">SUPABASE_SERVICE_ROLE_KEY</span> to{' '}
            <span className="font-mono">.env</span> and restart the server.
          </p>
        ) : null}
        {state && !state.providers.vectorBucket ? (
          <p className="mt-2 text-xs text-amber-300">
            Configure R2 <span className="font-mono">vector-db</span> credentials.
          </p>
        ) : null}

        {state ? (
          <div className="mt-4 space-y-2 font-mono text-[11px] text-text-secondary">
            <p>
              Table expects <span className="text-text-primary">{state.embeddingDims}</span> dims.
              Stick to one model for the whole corpus for best retrieval.
            </p>
            {state.rateLimit ? (
              <p>
                Safety caps: RPM {state.rateLimit.rpmUsed}/{state.rateLimit.rpmLimit} · TPM{' '}
                {state.rateLimit.tpmUsed.toLocaleString()}/{state.rateLimit.tpmLimit.toLocaleString()}{' '}
                · RPD {state.rateLimit.rpdUsed}/{state.rateLimit.rpdLimit}
                {state.rateLimit.nextSlotSeconds > 0
                  ? ` · next slot ~${state.rateLimit.nextSlotSeconds}s`
                  : ''}
              </p>
            ) : null}
            <p>
              Packs in R2: <span className="text-text-primary">{state.packCount ?? '—'}</span> · Indexed:{' '}
              <span className="text-text-primary">{state.indexedCount ?? '—'}</span> · Status:{' '}
              <span className="text-text-primary">{state.status}</span>
              {state.currentFolder ? ` · ${state.currentFolder}` : ''}
            </p>
            <p>
              Progress: {state.completed} embedded / {state.skipped} skipped / {state.failed} failed ·
              total {state.total}
            </p>
          </div>
        ) : (
          <p className="mt-3 font-mono text-[11px] text-text-secondary">Loading embed status…</p>
        )}

        {status ? <p className="mt-2 font-mono text-[11px] text-text-secondary">{status}</p> : null}
        {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
        {state?.lastError ? (
          <p className="mt-2 text-xs text-red-300">Last error: {state.lastError}</p>
        ) : null}

        {state?.logs?.length ? (
          <div className="mt-3 max-h-48 overflow-auto rounded border border-border bg-surface-base/50 p-2">
            <ul className="space-y-1 font-mono text-[10px] text-text-secondary">
              {state.logs.slice(0, 40).map((line) => (
                <li key={`${line.at}-${line.message}`}>
                  <span className="text-text-secondary/70">{new Date(line.at).toLocaleTimeString()}</span>{' '}
                  <span
                    className={
                      line.level === 'error'
                        ? 'text-red-300'
                        : line.level === 'warn'
                          ? 'text-amber-300'
                          : 'text-text-primary'
                    }
                  >
                    {line.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="rounded border border-border bg-surface-elevated/40 p-4">
        <h2 className="text-sm font-semibold text-text-primary">Test similarity search</h2>
        <p className="mt-1 text-xs text-text-secondary">
          Uses the same model id as above. Low-confidence / needs-review packs are filtered out for
          cleaner RAG neighbors.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="e.g. sci-fi sniper rifle"
            className="min-w-[220px] flex-1 rounded border border-border bg-surface-base px-3 py-2 text-sm text-text-primary"
            onKeyDown={(event) => {
              if (event.key === 'Enter') void runSearch()
            }}
          />
          <Button
            variant="primary"
            disabled={searchBusy || !searchQuery.trim() || !state?.configured}
            onClick={() => void runSearch()}
          >
            {searchBusy ? 'Searching…' : 'Search'}
          </Button>
        </div>
        {matches.length ? (
          <ul className="mt-3 space-y-2">
            {matches.map((match) => (
              <li
                key={match.id}
                className="rounded border border-border bg-surface-base/40 px-3 py-2 text-xs text-text-secondary"
              >
                <p className="font-mono text-[11px] text-text-primary">
                  {(match.similarity * 100).toFixed(1)}% · {match.r2_folder_key}
                </p>
                <p className="mt-1 text-text-primary">{match.description}</p>
                <p className="mt-1 font-mono text-[10px]">
                  {match.category}
                  {match.subcategory ? ` / ${match.subcategory}` : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  )
}
