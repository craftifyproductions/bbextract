import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import {
  generate2DAsset,
  getGenerate2DStatus,
  type Generate2DProgressLog,
  type Generate2DRequest,
  type SelectableImageModel,
} from '../../lib/generate2dApi'

const FALLBACK_MODELS: SelectableImageModel[] = [
  {
    id: 'cloudflare-worker',
    label: 'Free · Cloudflare Worker',
    description: 'Your Workers image API · recommended free path',
    tier: 'fast',
  },
  {
    id: 'gemini-2.5-flash-image',
    label: 'Nano Banana',
    description: 'Gemini 2.5 Flash Image · AI Studio Nano Banana',
    tier: 'fast',
  },
  {
    id: 'pollinations-flux',
    label: 'Free · Pollinations Flux',
    description: 'Fallback if Gemini quota fails · lower quality',
    tier: 'fast',
  },
  {
    id: 'gemini-3-pro-image',
    label: 'Nano Banana Pro',
    description: 'Gemini 3 Pro Image · higher quality',
    tier: 'quality',
  },
]

type TwoDAssetType = 'ui' | 'icon' | 'sprite' | 'texture' | 'concept'
type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
type ArtStyle = 'flat-ui' | 'pixel' | 'illustration' | 'game-asset' | 'wireframe-ui'

interface HistoryItem {
  id: string
  title: string
  assetType: TwoDAssetType
  createdAt: string
  status: 'ready' | 'failed' | 'queued'
  imageUrl?: string
  prompt?: string
}

interface LogEntry {
  id: string
  time: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
}

const ASSET_TYPES: { value: TwoDAssetType; label: string }[] = [
  { value: 'ui', label: 'UI screen' },
  { value: 'icon', label: 'Icon' },
  { value: 'sprite', label: 'Sprite' },
  { value: 'texture', label: 'Texture' },
  { value: 'concept', label: 'Concept art' },
]

const ASPECT_RATIOS: { value: AspectRatio; label: string }[] = [
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
]

const ART_STYLES: { value: ArtStyle; label: string }[] = [
  { value: 'flat-ui', label: 'Flat UI' },
  { value: 'pixel', label: 'Pixel' },
  { value: 'illustration', label: 'Illustration' },
  { value: 'game-asset', label: 'Game asset' },
  { value: 'wireframe-ui', label: 'Wireframe UI' },
]

const INITIAL_HISTORY: HistoryItem[] = [
  {
    id: '2d-hist-1',
    title: 'Inventory panel mock',
    assetType: 'ui',
    createdAt: '2026-07-30T11:20:00.000Z',
    status: 'ready',
  },
  {
    id: '2d-hist-2',
    title: 'Coin icon set',
    assetType: 'icon',
    createdAt: '2026-07-29T16:05:00.000Z',
    status: 'ready',
  },
  {
    id: '2d-hist-3',
    title: 'Grass tile texture',
    assetType: 'texture',
    createdAt: '2026-07-28T09:40:00.000Z',
    status: 'failed',
  },
]

function stampTime(): string {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function formatHistoryTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function Generate2DView() {
  const imageInputRef = useRef<HTMLInputElement>(null)
  const logsScrollRef = useRef<HTMLDivElement>(null)

  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [assetType, setAssetType] = useState<TwoDAssetType>('ui')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [artStyle, setArtStyle] = useState<ArtStyle>('flat-ui')
  const [imageName, setImageName] = useState<string | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [referenceDataUrl, setReferenceDataUrl] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [progressPercent, setProgressPercent] = useState(0)
  const [progressLabel, setProgressLabel] = useState('Idle')
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [resultTitle, setResultTitle] = useState<string | null>(null)
  const [basePrompt, setBasePrompt] = useState('')
  const [refineOpen, setRefineOpen] = useState(false)
  const [refinePrompt, setRefinePrompt] = useState('')
  const [apiConfigured, setApiConfigured] = useState<boolean | null>(null)
  const [selectableModels, setSelectableModels] = useState<SelectableImageModel[]>(FALLBACK_MODELS)
  const [selectedModelId, setSelectedModelId] = useState(FALLBACK_MODELS[0]!.id)
  const [activeModel, setActiveModel] = useState<string | null>(FALLBACK_MODELS[0]!.id)
  const [history, setHistory] = useState<HistoryItem[]>(INITIAL_HISTORY)
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(
    INITIAL_HISTORY[0]?.id ?? null,
  )
  const [logs, setLogs] = useState<LogEntry[]>(() => [
    {
      id: '2d-log-1',
      time: stampTime(),
      level: 'info',
      message: '2D workspace ready. Add a prompt to generate UI, icons, sprites, or textures.',
    },
  ])

  const canGenerate = Boolean(prompt.trim()) && !generating
  const hasResult = Boolean(resultUrl)

  const metadata = useMemo(
    () => [
      { label: 'Type', value: hasResult ? assetType : '—' },
      { label: 'Aspect', value: hasResult ? aspectRatio : '—' },
      { label: 'Style', value: hasResult ? artStyle : '—' },
      {
        label: 'Source',
        value: hasResult ? (activeModel ? activeModel : apiConfigured ? 'Gemini' : 'Local') : '—',
      },
    ],
    [activeModel, apiConfigured, artStyle, aspectRatio, assetType, hasResult],
  )

  const pushLog = useCallback((level: LogEntry['level'], message: string) => {
    setLogs((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        time: stampTime(),
        level,
        message,
      },
    ])
  }, [])

  const applyServerProgressLogs = useCallback(
    (progressLogs?: Generate2DProgressLog[]) => {
      if (!progressLogs?.length) return
      for (const entry of progressLogs) {
        pushLog(entry.level, `[${entry.stage}] ${entry.message}`)
      }
    },
    [pushLog],
  )

  useEffect(() => {
    const el = logsScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [logs])

  useEffect(() => {
    if (!refineOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !generating) {
        setRefineOpen(false)
        setRefinePrompt('')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [generating, refineOpen])

  useEffect(() => {
    let cancelled = false
    getGenerate2DStatus()
      .then((status) => {
        if (cancelled) return
        setApiConfigured(status.configured)
        if (status.selectableModels?.length) {
          setSelectableModels(status.selectableModels)
          const preferred =
            status.model && status.selectableModels.some((model) => model.id === status.model)
              ? status.model
              : status.selectableModels[0]!.id
          setSelectedModelId(preferred)
          setActiveModel(preferred)
        } else if (status.model) {
          setActiveModel(status.model)
          setSelectedModelId(status.model)
        }
        if (status.cloudflareWorkerConfigured) {
          pushLog('info', 'Cloudflare Worker image API connected (recommended free path).')
        } else if (status.providers?.pollinations) {
          pushLog(
            'warn',
            'Cloudflare Worker key missing — add CF_WORKER_IMAGE_API_KEY to .env. Pollinations remains as fallback.',
          )
        }
        if (status.geminiConfigured) {
          pushLog(
            'info',
            `Gemini key detected — Nano Banana models available when quota allows. Default: ${status.model ?? 'unset'}.`,
          )
        }
      })
      .catch(() => {
        if (cancelled) return
        setApiConfigured(false)
        pushLog(
          'warn',
          'Could not reach generate API status. Live generation will retry when you press Generate.',
        )
      })
    return () => {
      cancelled = true
    }
  }, [pushLog])

  const handleImageFile = useCallback(
    (file: File | undefined) => {
      if (!file) return
      if (!file.type.startsWith('image/')) {
        pushLog('warn', `Ignored non-image file: ${file.name}`)
        return
      }
      if (file.size > 6 * 1024 * 1024) {
        pushLog('warn', `Reference image too large (>6MB): ${file.name}`)
        return
      }

      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : null
        if (!dataUrl) {
          pushLog('error', `Failed to read reference image: ${file.name}`)
          return
        }
        setImageName(file.name)
        setImagePreviewUrl(dataUrl)
        setReferenceDataUrl(dataUrl)
        pushLog('info', `Reference image loaded: ${file.name} (${Math.round(file.size / 1024)} KB)`)
      }
      reader.onerror = () => {
        pushLog('error', `Failed to read reference image: ${file.name}`)
      }
      reader.readAsDataURL(file)
    },
    [pushLog],
  )

  const clearImage = useCallback(() => {
    setImageName(null)
    setImagePreviewUrl(null)
    setReferenceDataUrl(null)
    pushLog('debug', 'Reference image cleared')
  }, [pushLog])

  const runGeneration = useCallback(
    async (options?: {
      refine?: boolean
      refinePrompt?: string
      referenceImageDataUrl?: string | null
      referenceImageName?: string | null
      keepCurrentPreview?: boolean
    }) => {
      const isRefine = Boolean(options?.refine)
      const refineText = options?.refinePrompt?.trim() ?? ''
      const workingPrompt = (isRefine ? basePrompt || prompt : prompt).trim()
      if (!workingPrompt && !isRefine) return
      if (isRefine && !refineText) {
        pushLog('warn', 'Enter a refine prompt before applying changes.')
        return
      }
      if (generating) return

      const title = isRefine
        ? `Refine: ${refineText.slice(0, 34)}`
        : workingPrompt.slice(0, 42) || 'Untitled 2D asset'

      const payload: Generate2DRequest = {
        prompt: workingPrompt || refineText,
        negativePrompt: negativePrompt.trim() || undefined,
        assetType,
        aspectRatio,
        artStyle,
        model: selectedModelId,
        referenceImageName: options?.referenceImageName ?? imageName ?? undefined,
        referenceImageDataUrl:
          options?.referenceImageDataUrl ?? referenceDataUrl ?? undefined,
        refine: isRefine || undefined,
        refinePrompt: isRefine ? refineText : undefined,
      }

      setGenerating(true)
      setProgressPercent(8)
      setProgressLabel(isRefine ? 'Refine queued' : 'Queued')
      if (!options?.keepCurrentPreview) {
        setResultUrl(null)
        setResultTitle(null)
      }

      const selectedLabel =
        selectableModels.find((model) => model.id === selectedModelId)?.label ?? selectedModelId
      pushLog('info', `${isRefine ? 'Queued refine' : 'Queued 2D job'} — "${title}"`)
      pushLog('info', `Model → ${selectedLabel} (${selectedModelId})`)
      pushLog('info', `Settings → type=${assetType} · aspect=${aspectRatio} · style=${artStyle}`)
      if (isRefine) {
        pushLog('info', `Refine prompt: ${refineText}`)
        if (payload.referenceImageDataUrl) {
          pushLog('info', 'Using current generated image as refine base')
        }
      } else if (payload.referenceImageDataUrl) {
        pushLog(
          'info',
          `Including reference image${payload.referenceImageName ? `: ${payload.referenceImageName}` : ''}`,
        )
      }

      const waitingLabel = selectedModelId.startsWith('pollinations-')
        ? 'Waiting for Pollinations'
        : selectedModelId === 'cloudflare-worker'
          ? 'Waiting for Cloudflare Worker'
          : 'Waiting for Gemini'

      const clientStages = [
        {
          at: 400,
          percent: 22,
          label: isRefine ? 'Preparing refine' : 'Building prompt',
          message: isRefine
            ? 'Preparing refine instructions from your prompt…'
            : 'Composing prompt from selected settings…',
        },
        {
          at: 1200,
          percent: 45,
          label: isRefine ? 'Editing image' : 'Calling provider',
          message: isRefine
            ? 'Sending current image + refine prompt to the model…'
            : 'Waiting for image provider response…',
        },
        { at: 2800, percent: 70, label: 'Rendering', message: 'Model is rendering pixels…' },
        {
          at: 5000,
          percent: 88,
          label: waitingLabel,
          message: `Still waiting — progress stays here until the API responds…`,
        },
      ] as const

      const timers: number[] = clientStages.map((stage) =>
        window.setTimeout(() => {
          setProgressPercent(stage.percent)
          setProgressLabel(stage.label)
          pushLog('debug', stage.message)
        }, stage.at),
      )

      const heartbeatId = window.setInterval(() => {
        setProgressPercent((prev) => {
          if (prev < 88) return prev
          return Math.min(96, prev + 1)
        })
        setProgressLabel(waitingLabel)
      }, 2500)

      const heartbeatLogId = window.setInterval(() => {
        pushLog('debug', 'Still waiting for image provider response…')
      }, 8000)

      const clearClientTimers = () => {
        timers.forEach((id) => window.clearTimeout(id))
        window.clearInterval(heartbeatId)
        window.clearInterval(heartbeatLogId)
      }

      try {
        const response = await generate2DAsset(payload, { timeoutMs: 90_000 })
        clearClientTimers()
        applyServerProgressLogs(response.progressLogs)

        if (response.imageDataUrl) {
          const item: HistoryItem = {
            id: crypto.randomUUID(),
            title: response.title || title,
            assetType,
            createdAt: new Date().toISOString(),
            status: 'ready',
            imageUrl: response.imageDataUrl,
            prompt: isRefine ? `${workingPrompt} | refine: ${refineText}` : workingPrompt,
          }
          setHistory((prev) => [item, ...prev])
          setSelectedHistoryId(item.id)
          setResultUrl(response.imageDataUrl)
          setResultTitle(item.title)
          if (!isRefine) setBasePrompt(workingPrompt)
          if (response.model) setActiveModel(response.model)
          setProgressPercent(100)
          setProgressLabel(isRefine ? 'Refine complete' : 'Complete')
          pushLog(
            'info',
            `${isRefine ? 'Refine' : 'Generation'} complete: ${item.title}${
              response.model ? ` · ${response.model}` : ''
            }`,
          )
          if (response.note) pushLog('debug', response.note)
          if (isRefine) {
            setRefineOpen(false)
            setRefinePrompt('')
          }
        } else {
          throw new Error(response.error || 'No image returned from generate API')
        }
      } catch (error) {
        clearClientTimers()
        const progressLogs =
          error && typeof error === 'object' && 'progressLogs' in error
            ? (error as { progressLogs?: Generate2DProgressLog[] }).progressLogs
            : undefined
        applyServerProgressLogs(progressLogs)

        const message = error instanceof Error ? error.message : '2D generation failed'
        const item: HistoryItem = {
          id: crypto.randomUUID(),
          title,
          assetType,
          createdAt: new Date().toISOString(),
          status: 'failed',
          prompt: isRefine ? refineText : workingPrompt,
        }
        setHistory((prev) => [item, ...prev])
        setSelectedHistoryId(item.id)
        setProgressPercent(0)
        setProgressLabel('Failed')
        pushLog('error', message)
      } finally {
        setGenerating(false)
      }
    },
    [
      applyServerProgressLogs,
      artStyle,
      aspectRatio,
      assetType,
      basePrompt,
      generating,
      imageName,
      negativePrompt,
      prompt,
      pushLog,
      referenceDataUrl,
      selectableModels,
      selectedModelId,
    ],
  )

  const handleGenerate = useCallback(() => {
    if (!canGenerate) return
    void runGeneration()
  }, [canGenerate, runGeneration])

  const handleRefine = useCallback(() => {
    if (!resultUrl || !refinePrompt.trim() || generating) return
    void runGeneration({
      refine: true,
      refinePrompt: refinePrompt.trim(),
      referenceImageDataUrl: resultUrl,
      referenceImageName: 'current-generation.png',
      keepCurrentPreview: true,
    })
  }, [generating, refinePrompt, resultUrl, runGeneration])

  const downloadResult = useCallback(() => {
    if (!resultUrl) return
    const ext = resultUrl.startsWith('data:image/svg')
      ? 'svg'
      : resultUrl.startsWith('data:image/jpeg')
        ? 'jpg'
        : 'png'
    const link = document.createElement('a')
    link.href = resultUrl
    link.download = `${(resultTitle || 'bbextract-2d').replace(/[^\w.-]+/g, '_')}.${ext}`
    link.click()
    pushLog('info', `Download started: ${resultTitle ?? '2D asset'}`)
  }, [pushLog, resultTitle, resultUrl])

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(240px,280px)_minmax(0,1fr)_minmax(220px,260px)]">
        {/* Left input panel */}
        <section className="space-y-4 rounded border border-border bg-surface-elevated/30 p-4">
          <div>
            <p className="mb-1.5 text-xs uppercase tracking-wide text-text-secondary">
              Reference image (optional)
            </p>
            <div
              className={`relative flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed px-3 py-4 text-center transition-colors ${
                dragOver
                  ? 'border-accent bg-accent/10'
                  : 'border-border/80 bg-surface-base/60 hover:border-accent/40'
              }`}
              onDragOver={(event) => {
                event.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragOver(false)
                handleImageFile(event.dataTransfer.files?.[0])
              }}
              onClick={() => imageInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  imageInputRef.current?.click()
                }
              }}
            >
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  handleImageFile(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
              {imagePreviewUrl ? (
                <img
                  src={imagePreviewUrl}
                  alt="Reference"
                  className="max-h-24 rounded object-contain"
                />
              ) : (
                <>
                  <p className="text-sm text-text-primary">Drop image or click</p>
                  <p className="mt-1 font-mono text-[11px] text-text-secondary">PNG, JPG, WEBP</p>
                </>
              )}
            </div>
            {imageName ? (
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="truncate font-mono text-[11px] text-text-secondary">{imageName}</p>
                <button
                  type="button"
                  onClick={clearImage}
                  className="shrink-0 font-mono text-[11px] text-text-secondary hover:text-text-primary"
                >
                  Clear
                </button>
              </div>
            ) : null}
            <p className="mt-2 font-mono text-[10px] leading-snug text-text-secondary">
              Reference is used as img2img. Cloudflare Worker is text-only, so jobs with a
              reference auto-switch to Pollinations img2img (or Gemini when available).
            </p>
          </div>

          <div>
            <label
              htmlFor="generate-2d-model"
              className="mb-1.5 block text-xs uppercase tracking-wide text-text-secondary"
            >
              Model
            </label>
            <select
              id="generate-2d-model"
              value={selectedModelId}
              disabled={generating}
              onChange={(event) => {
                setSelectedModelId(event.target.value)
                setActiveModel(event.target.value)
                const option = selectableModels.find((model) => model.id === event.target.value)
                pushLog(
                  'debug',
                  `Model selected: ${option?.label ?? event.target.value}`,
                )
              }}
              className="w-full rounded border border-border bg-surface-base px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none disabled:opacity-50"
            >
              {selectableModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 font-mono text-[11px] text-text-secondary">
              {selectableModels.find((model) => model.id === selectedModelId)?.description ??
                'Select an image model'}
              {' · '}
              <span className="uppercase tracking-wide">
                {selectableModels.find((model) => model.id === selectedModelId)?.tier ?? '—'}
              </span>
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wide text-text-secondary">
              Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={4}
              placeholder="e.g. Dark inventory panel UI with gold borders and slot grid…"
              className="w-full resize-y rounded border border-border bg-surface-base px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/70 focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wide text-text-secondary">
              Negative prompt
            </label>
            <textarea
              value={negativePrompt}
              onChange={(event) => setNegativePrompt(event.target.value)}
              rows={2}
              placeholder="blurry, watermark, text artifacts…"
              className="w-full resize-y rounded border border-border bg-surface-base px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/70 focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <p className="mb-1.5 text-xs uppercase tracking-wide text-text-secondary">Asset type</p>
            <div className="grid grid-cols-2 gap-1.5">
              {ASSET_TYPES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setAssetType(option.value)}
                  className={`rounded border px-2 py-1.5 text-xs transition-colors ${
                    assetType === option.value
                      ? 'border-accent/50 bg-accent/10 text-text-primary'
                      : 'border-border text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs uppercase tracking-wide text-text-secondary">Aspect ratio</p>
            <div className="flex flex-wrap gap-1.5">
              {ASPECT_RATIOS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setAspectRatio(option.value)}
                  className={`rounded border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                    aspectRatio === option.value
                      ? 'border-accent/50 bg-accent/10 text-text-primary'
                      : 'border-border text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs uppercase tracking-wide text-text-secondary">Art style</p>
            <div className="grid grid-cols-1 gap-1.5">
              {ART_STYLES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setArtStyle(option.value)}
                  className={`rounded border px-3 py-2 text-left text-xs transition-colors ${
                    artStyle === option.value
                      ? 'border-accent/50 bg-accent/10 text-text-primary'
                      : 'border-border text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <Button
              variant="primary"
              className="w-full py-3 text-sm"
              disabled={!canGenerate}
              onClick={() => void handleGenerate()}
            >
              {generating ? 'Generating…' : 'Generate 2D'}
            </Button>
            <p className="font-mono text-[11px] text-text-secondary">
                  {apiConfigured === null
                ? 'Checking image providers…'
                : selectedModelId === 'cloudflare-worker'
                  ? 'Using Cloudflare Worker free image API'
                  : selectedModelId.startsWith('pollinations-')
                    ? 'Using free Pollinations Flux'
                    : 'Using Google Gemini · falls back to Cloudflare/Pollinations if quota fails'}
            </p>
          </div>
        </section>

        {/* Main preview */}
        <section className="min-w-0 space-y-4">
          <div className="overflow-hidden rounded border border-border bg-surface-elevated/30">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    generating
                      ? 'bg-accent-warm'
                      : hasResult
                        ? 'bg-emerald-400'
                        : 'bg-text-secondary'
                  }`}
                />
                <p className="font-mono text-xs text-text-secondary">
                  2D Preview ·{' '}
                  {generating
                    ? `${progressLabel} · ${progressPercent}%`
                    : hasResult
                      ? 'Ready'
                      : 'Idle'}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button variant="ghost" size="sm" disabled={!hasResult} onClick={downloadResult}>
                  Download
                </Button>
              </div>
            </div>

            {(generating || progressPercent > 0) && (
              <div className="border-b border-border px-3 py-2">
                <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[11px] text-text-secondary">
                  <span>{progressLabel}</span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-sm bg-surface-base">
                  <div
                    className="h-full bg-accent-warm transition-[width] duration-300 ease-out"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            <div className="relative flex min-h-[320px] items-center justify-center bg-[#14161a] sm:min-h-[420px]">
              {generating ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#14161a]/90">
                  <div className="text-center">
                    <div className="mx-auto h-12 w-12 animate-pulse rounded border border-accent-warm/40" />
                    <p className="mt-4 font-mono text-xs text-accent-warm">
                      {progressLabel}… {progressPercent}%
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-text-secondary">
                      {selectedModelId} · {assetType} · {aspectRatio} · {artStyle}
                    </p>
                  </div>
                </div>
              ) : null}

              {resultUrl ? (
                <img
                  src={resultUrl}
                  alt={resultTitle ?? 'Generated 2D asset'}
                  className="max-h-[420px] max-w-full object-contain px-4 py-4"
                />
              ) : (
                <div className="max-w-sm px-4 text-center">
                  <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded border border-dashed border-border">
                    <svg width="28" height="28" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <rect
                        x="2.5"
                        y="3.5"
                        width="11"
                        height="9"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        className="text-text-secondary"
                      />
                      <path
                        d="M2.5 10.5l3-2.5 2.5 2 3.5-3 2.5 2"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        className="text-text-secondary"
                      />
                    </svg>
                  </div>
                  <p className="text-sm text-text-secondary">
                    Generated UI, icons, sprites, and textures will appear here.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {metadata.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded border border-border bg-surface-elevated/40 px-3 py-2.5"
                >
                  <p className="text-[11px] uppercase tracking-wide text-text-secondary">
                    {stat.label}
                  </p>
                  <p className="mt-1 truncate font-mono text-sm text-text-primary">{stat.value}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={!hasResult || generating}
                onClick={() => {
                  setRefineOpen(true)
                  pushLog('debug', 'Refine panel opened — describe the changes you want.')
                }}
              >
                Refine
              </Button>
              <Button variant="primary" disabled={!hasResult} onClick={downloadResult}>
                Download
              </Button>
            </div>
          </div>
        </section>

        {refineOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="refine-dialog-title"
              className="w-full max-w-lg rounded border border-border bg-surface-base shadow-xl"
            >
              <div className="border-b border-border px-4 py-3">
                <h3 id="refine-dialog-title" className="text-sm font-semibold text-text-primary">
                  Refine generated image
                </h3>
                <p className="mt-0.5 text-xs text-text-secondary">
                  Describe what to change. The current image is used as the base.
                </p>
              </div>

              <div className="space-y-3 p-4">
                {resultUrl ? (
                  <div className="flex justify-center rounded border border-border bg-[#14161a] p-3">
                    <img
                      src={resultUrl}
                      alt="Current generation"
                      className="max-h-40 max-w-full object-contain"
                    />
                  </div>
                ) : null}

                <div>
                  <label
                    htmlFor="refine-prompt"
                    className="mb-1.5 block text-xs uppercase tracking-wide text-text-secondary"
                  >
                    Refine prompt
                  </label>
                  <textarea
                    id="refine-prompt"
                    value={refinePrompt}
                    onChange={(event) => setRefinePrompt(event.target.value)}
                    rows={4}
                    autoFocus
                    placeholder="e.g. Make the gold brighter, add a soft glow, keep the same layout…"
                    className="w-full resize-y rounded border border-border bg-surface-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/70 focus:border-accent focus:outline-none"
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                        event.preventDefault()
                        handleRefine()
                      }
                    }}
                  />
                  <p className="mt-1 font-mono text-[11px] text-text-secondary">
                    Tip: Ctrl/Cmd + Enter to apply
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={generating}
                  onClick={() => {
                    setRefineOpen(false)
                    setRefinePrompt('')
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!refinePrompt.trim() || generating || !resultUrl}
                  onClick={handleRefine}
                >
                  {generating ? 'Refining…' : 'Apply refine'}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {/* History */}
        <aside className="flex min-h-[320px] flex-col rounded border border-border bg-surface-elevated/30 xl:min-h-0">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-text-primary">2D History</h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              {history.length} recent run{history.length === 1 ? '' : 's'}
            </p>
          </div>

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {history.length === 0 ? (
              <p className="px-2 py-4 text-xs text-text-secondary">No generations yet.</p>
            ) : (
              history.map((item) => {
                const active = item.id === selectedHistoryId
                return (
                  <div
                    key={item.id}
                    className={`flex items-stretch gap-1 rounded border transition-colors ${
                      active
                        ? 'border-accent/40 bg-accent/10'
                        : 'border-transparent hover:border-border hover:bg-surface-elevated'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedHistoryId(item.id)
                        if (item.status === 'ready' && item.imageUrl) {
                          setResultUrl(item.imageUrl)
                          setResultTitle(item.title)
                          if (item.prompt) {
                            const original = item.prompt.split(' | refine:')[0]?.trim()
                            if (original) setBasePrompt(original)
                          }
                        } else if (item.status !== 'ready') {
                          setResultUrl(null)
                          setResultTitle(null)
                        }
                      }}
                      className="min-w-0 flex-1 px-3 py-2.5 text-left"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm text-text-primary">{item.title}</p>
                        <StatusChip status={item.status} />
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-text-secondary">
                        {item.assetType}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-text-secondary">
                        {formatHistoryTime(item.createdAt)}
                      </p>
                    </button>
                    <button
                      type="button"
                      title={`Delete ${item.title}`}
                      aria-label={`Delete ${item.title}`}
                      onClick={() => {
                        const remaining = history.filter((entry) => entry.id !== item.id)
                        setHistory(remaining)
                        if (selectedHistoryId === item.id) {
                          const fallback = remaining[0] ?? null
                          setSelectedHistoryId(fallback?.id ?? null)
                          if (fallback?.imageUrl) {
                            setResultUrl(fallback.imageUrl)
                            setResultTitle(fallback.title)
                          } else {
                            setResultUrl(null)
                            setResultTitle(null)
                          }
                        }
                        pushLog('info', `Removed from history: ${item.title}`)
                      }}
                      className="m-1.5 shrink-0 self-start rounded border border-transparent px-2 py-1 font-mono text-[10px] text-text-secondary transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </aside>
      </div>

      {/* Logs */}
      <section className="rounded border border-border bg-surface-elevated/30">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">2D Generation Logs</h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              Timestamped output for this 2D session.
            </p>
          </div>
          <Button variant="secondary" size="sm" disabled={logs.length === 0} onClick={() => setLogs([])}>
            Clear
          </Button>
        </div>
        <div
          ref={logsScrollRef}
          className="max-h-48 overflow-y-auto bg-[#0f1115] p-4 font-mono text-xs leading-relaxed"
        >
          {logs.length === 0 ? (
            <p className="text-text-secondary">No log entries yet.</p>
          ) : (
            <div className="space-y-1">
              {logs.map((entry) => (
                <div
                  key={entry.id}
                  className={`whitespace-pre-wrap break-words ${logLevelClass(entry.level)}`}
                >
                  <span className="text-text-secondary">[{entry.time}]</span> {entry.message}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function StatusChip({ status }: { status: HistoryItem['status'] }) {
  const styles =
    status === 'ready'
      ? 'border-emerald-500/30 text-emerald-300'
      : status === 'failed'
        ? 'border-red-500/30 text-red-300'
        : 'border-accent-warm/30 text-accent-warm'

  return (
    <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] ${styles}`}>
      {status}
    </span>
  )
}

function logLevelClass(level: LogEntry['level']): string {
  if (level === 'warn') return 'text-yellow-400'
  if (level === 'error') return 'text-red-400'
  if (level === 'debug') return 'text-text-secondary'
  return 'text-text-primary'
}
