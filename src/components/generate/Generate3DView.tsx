import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Quaternion } from 'three'
import { Button } from '../ui/Button'
import { WireframeCube } from '../ui/WireframeCube'
import type { DemoModelId, LightDirection, SkyMode } from './demoModel'
import { DEMO_MODELS } from './demoModel'
import { ModelPreviewStrip } from './ModelPreviewStrip'
import { ModelViewer3D, type ModelViewer3DHandle, type ViewerAngle } from './ModelViewer3D'
import { ViewerLightGizmo } from './ViewerLightGizmo'
import { ViewerViewCube } from './ViewerViewCube'

type GenerationMode = 'model' | 'animation'
type AssetType = 'character' | 'prop' | 'creature' | 'environment'
type Complexity = 'low' | 'medium' | 'high'

interface HistoryItem {
  id: string
  title: string
  mode: GenerationMode
  assetType: AssetType
  createdAt: string
  status: 'ready' | 'failed' | 'queued'
  demoModelId?: DemoModelId
}

interface LogEntry {
  id: string
  time: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
}

interface MetadataStat {
  label: string
  value: string
}

const ASSET_TYPES: { value: AssetType; label: string }[] = [
  { value: 'character', label: 'Character' },
  { value: 'prop', label: 'Prop' },
  { value: 'creature', label: 'Creature' },
  { value: 'environment', label: 'Environment' },
]

const COMPLEXITY_OPTIONS: { value: Complexity; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

const ANGLE_OPTIONS: { label: string; angle: ViewerAngle }[] = [
  { label: 'Front', angle: 'front' },
  { label: '3/4 Left', angle: 'threeQuarter' },
  { label: 'Right', angle: 'side' },
  { label: 'Left', angle: 'left' },
  { label: 'Back', angle: 'back' },
  { label: 'Top', angle: 'top' },
  { label: 'Detail', angle: 'detail' },
]

const EMPTY_METADATA: MetadataStat[] = [
  { label: 'Vertices', value: '—' },
  { label: 'Triangles', value: '—' },
  { label: 'Bones', value: '—' },
  { label: 'File size', value: '—' },
]

const SAMPLE_METADATA: MetadataStat[] = DEMO_MODELS[0].metadata

const INITIAL_HISTORY: HistoryItem[] = [
  {
    id: 'hist-1',
    title: 'Fox scout idle',
    mode: 'animation',
    assetType: 'creature',
    createdAt: '2026-07-29T10:12:00.000Z',
    status: 'ready',
    demoModelId: 'creature',
  },
  {
    id: 'hist-2',
    title: 'Block hero',
    mode: 'model',
    assetType: 'character',
    createdAt: '2026-07-28T18:40:00.000Z',
    status: 'ready',
    demoModelId: 'character',
  },
  {
    id: 'hist-3',
    title: 'Cave entrance',
    mode: 'model',
    assetType: 'environment',
    createdAt: '2026-07-27T14:05:00.000Z',
    status: 'failed',
  },
]

const INITIAL_LOGS: LogEntry[] = [
  {
    id: 'log-1',
    time: '19:02:11',
    level: 'info',
    message: 'Generate workspace ready. Upload a reference image to begin.',
  },
]

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

function estimateSeconds(complexity: Complexity, mode: GenerationMode): number {
  const base = mode === 'animation' ? 45 : 30
  if (complexity === 'low') return base
  if (complexity === 'medium') return base + 20
  return base + 45
}

function stampTime(): string {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export function Generate3DView() {
  const imageInputRef = useRef<HTMLInputElement>(null)
  const logsScrollRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<ModelViewer3DHandle>(null)
  const cameraQuaternionRef = useRef(new Quaternion())

  const [prompt, setPrompt] = useState('')
  const [assetType, setAssetType] = useState<AssetType>('character')
  const [complexity, setComplexity] = useState<Complexity>('medium')
  const [mode, setMode] = useState<GenerationMode>('model')
  const [imageName, setImageName] = useState<string | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [hasResult, setHasResult] = useState(false)
  const [viewerPlaying, setViewerPlaying] = useState(false)
  const [timeline, setTimeline] = useState(0)
  const [selectedAngle, setSelectedAngle] = useState(0)
  const [wireframe, setWireframe] = useState(false)
  const [showGrid, setShowGrid] = useState(true)
  const [lightDirection, setLightDirection] = useState<LightDirection>('front')
  const [lightPosition, setLightPosition] = useState<[number, number, number] | null>(null)
  const [skyMode, setSkyMode] = useState<SkyMode>('night')
  const [viewerExpanded, setViewerExpanded] = useState(false)
  const [demoModelId, setDemoModelId] = useState<DemoModelId>(
    INITIAL_HISTORY[0]?.demoModelId ?? 'character',
  )
  const [history, setHistory] = useState<HistoryItem[]>(INITIAL_HISTORY)
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(INITIAL_HISTORY[0]?.id ?? null)
  const [logs, setLogs] = useState<LogEntry[]>(INITIAL_LOGS)

  const estimate = useMemo(() => estimateSeconds(complexity, mode), [complexity, mode])
  const metadata = useMemo(() => {
    if (!hasResult) return EMPTY_METADATA
    return DEMO_MODELS.find((option) => option.id === demoModelId)?.metadata ?? SAMPLE_METADATA
  }, [demoModelId, hasResult])
  const canGenerate = Boolean(prompt.trim() || imageName) && !generating

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

  useEffect(() => {
    const el = logsScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [logs])

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    }
  }, [imagePreviewUrl])

  useEffect(() => {
    if (!viewerPlaying) return
    const timer = window.setInterval(() => {
      setTimeline((prev) => (prev >= 100 ? 0 : prev + 2))
    }, 120)
    return () => window.clearInterval(timer)
  }, [viewerPlaying])

  useEffect(() => {
    if (!viewerExpanded) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setViewerExpanded(false)
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [viewerExpanded])

  useEffect(() => {
    if (!hasResult && viewerExpanded) setViewerExpanded(false)
  }, [hasResult, viewerExpanded])

  const handleImageFile = useCallback(
    (file: File | undefined) => {
      if (!file) return
      if (!file.type.startsWith('image/')) {
        pushLog('warn', `Ignored non-image file: ${file.name}`)
        return
      }
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
      const url = URL.createObjectURL(file)
      setImageName(file.name)
      setImagePreviewUrl(url)
      pushLog('info', `Reference image loaded: ${file.name}`)
    },
    [imagePreviewUrl, pushLog],
  )

  const clearImage = useCallback(() => {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    setImageName(null)
    setImagePreviewUrl(null)
    pushLog('debug', 'Reference image cleared')
  }, [imagePreviewUrl, pushLog])

  const loadDemoPreview = useCallback(
    (modelId: DemoModelId = demoModelId) => {
      setHasResult(true)
      setGenerating(false)
      setViewerPlaying(false)
      setTimeline(0)
      setSelectedAngle(1)
      setWireframe(false)
      setDemoModelId(modelId)
      pushLog('debug', `Loaded demo preview: ${DEMO_MODELS.find((option) => option.id === modelId)?.label ?? modelId}`)
    },
    [demoModelId, pushLog],
  )

  const handleGenerate = useCallback(() => {
    if (!canGenerate) return

    const title =
      prompt.trim().slice(0, 42) ||
      (imageName ? imageName.replace(/\.[^.]+$/, '') : 'Untitled generation')

    setGenerating(true)
    setHasResult(false)
    setViewerPlaying(false)
    setTimeline(0)
    pushLog('info', `Queued ${mode} generation — ${assetType}, complexity ${complexity}`)
    pushLog('debug', `Estimated duration ~${estimate}s`)

    window.setTimeout(() => {
      pushLog('info', 'Building mesh preview…')
    }, 700)

    window.setTimeout(() => {
      const item: HistoryItem = {
        id: crypto.randomUUID(),
        title,
        mode,
        assetType,
        createdAt: new Date().toISOString(),
        status: 'ready',
        demoModelId,
      }
      setHistory((prev) => [item, ...prev])
      setSelectedHistoryId(item.id)
      setHasResult(true)
      setGenerating(false)
      setSelectedAngle(1)
      setWireframe(false)
      pushLog('info', `Generation complete: ${title}`)
    }, 2200)
  }, [assetType, canGenerate, complexity, demoModelId, estimate, imageName, mode, prompt, pushLog])

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(240px,280px)_minmax(0,1fr)_minmax(220px,260px)]">
        {/* Left input panel */}
        <section className="space-y-4 rounded border border-border bg-surface-elevated/30 p-4">
          <div>
            <p className="mb-1.5 text-xs uppercase tracking-wide text-text-secondary">Reference image</p>
            <div
              className={`relative flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed px-3 py-4 text-center transition-colors ${
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
                <div className="w-full space-y-2">
                  <img
                    src={imagePreviewUrl}
                    alt=""
                    className="mx-auto max-h-24 rounded border border-border object-contain"
                  />
                  <p className="truncate font-mono text-[11px] text-text-secondary">{imageName}</p>
                  <button
                    type="button"
                    className="font-mono text-[11px] text-accent hover:underline"
                    onClick={(event) => {
                      event.stopPropagation()
                      clearImage()
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-text-primary">Drop image here</p>
                  <p className="mt-1 text-xs text-text-secondary">or click to browse</p>
                </>
              )}
            </div>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs uppercase tracking-wide text-text-secondary">
              Prompt
            </span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
              placeholder="Describe the model or animation you want to generate…"
              className="w-full resize-y rounded border border-border bg-surface-base px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/70 focus:border-accent/50 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs uppercase tracking-wide text-text-secondary">
              Asset type
            </span>
            <select
              value={assetType}
              onChange={(event) => setAssetType(event.target.value as AssetType)}
              className="w-full rounded border border-border bg-surface-base px-3 py-2 text-sm text-text-primary focus:border-accent/50 focus:outline-none"
            >
              {ASSET_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs uppercase tracking-wide text-text-secondary">
              Complexity
            </span>
            <select
              value={complexity}
              onChange={(event) => setComplexity(event.target.value as Complexity)}
              className="w-full rounded border border-border bg-surface-base px-3 py-2 text-sm text-text-primary focus:border-accent/50 focus:outline-none"
            >
              {COMPLEXITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div>
            <p className="mb-1.5 text-xs uppercase tracking-wide text-text-secondary">
              Generation mode
            </p>
            <div
              className="flex gap-1 rounded border border-border bg-surface-base p-1"
              role="tablist"
              aria-label="Generation mode"
            >
              {(
                [
                  { id: 'model' as const, label: '3D Model' },
                  { id: 'animation' as const, label: 'Animation' },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="tab"
                  aria-selected={mode === option.id}
                  onClick={() => setMode(option.id)}
                  className={`flex-1 rounded px-2 py-2 text-xs transition-colors ${
                    mode === option.id
                      ? 'bg-surface-elevated text-text-primary'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-text-secondary">Test preview model</p>
            <div className="grid grid-cols-1 gap-1.5">
              {DEMO_MODELS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setDemoModelId(option.id)
                    if (hasResult) {
                      pushLog('debug', `Switched preview model to ${option.label}`)
                    }
                  }}
                  className={`rounded border px-3 py-2 text-left transition-colors ${
                    demoModelId === option.id
                      ? 'border-accent/50 bg-accent/10'
                      : 'border-border bg-surface-base/60 hover:border-accent/30 hover:bg-surface-elevated'
                  }`}
                >
                  <p className="text-sm text-text-primary">{option.label}</p>
                  <p className="mt-0.5 text-[11px] text-text-secondary">{option.description}</p>
                </button>
              ))}
            </div>
            <Button
              variant="secondary"
              className="w-full text-xs"
              onClick={() => loadDemoPreview(demoModelId)}
            >
              Load demo preview
            </Button>
          </div>

          <div className="space-y-2 pt-1">
            <Button
              variant="primary"
              className="w-full py-3 text-sm"
              disabled={!canGenerate}
              onClick={handleGenerate}
            >
              {generating ? 'Generating…' : 'Generate'}
            </Button>
            <p className="font-mono text-[11px] text-text-secondary">
              Est. ~{estimate}s · {mode === 'model' ? 'mesh + textures' : 'rig + keyframes'} ·{' '}
              {complexity} detail
            </p>
          </div>
        </section>

        {/* Main content */}
        <section className="min-w-0 space-y-4">
          <ModelPreviewStrip
            active={hasResult && !generating}
            modelId={demoModelId}
            selectedAngle={ANGLE_OPTIONS[selectedAngle]?.angle ?? 'threeQuarter'}
            onSelectView={(_view, angle) => {
              const index = ANGLE_OPTIONS.findIndex((option) => option.angle === angle)
              if (index >= 0) setSelectedAngle(index)
            }}
          />

          {viewerExpanded ? (
            <div
              className="min-h-[380px] rounded border border-dashed border-border bg-surface-elevated/20"
              aria-hidden
            />
          ) : null}

          <div
            className={
              viewerExpanded
                ? 'fixed inset-0 z-50 flex flex-col border-0 bg-surface-base'
                : 'overflow-hidden rounded border border-border bg-surface-elevated/30'
            }
          >
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
                  Viewer ·{' '}
                  {generating
                    ? 'Building preview…'
                    : hasResult
                      ? viewerExpanded
                        ? 'Fullscreen'
                        : 'Interactive'
                      : 'Idle'}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!hasResult}
                  onClick={() => {
                    viewerRef.current?.reset()
                    setSelectedAngle(1)
                  }}
                >
                  Reset
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!hasResult}
                  onClick={() => {
                    const next = !wireframe
                    setWireframe(next)
                    viewerRef.current?.setWireframe(next)
                  }}
                >
                  {wireframe ? 'Solid' : 'Wireframe'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!hasResult}
                  onClick={() => setShowGrid((prev) => !prev)}
                >
                  {showGrid ? 'Hide grid' : 'Show grid'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!hasResult}
                  onClick={() => setSkyMode((prev) => (prev === 'night' ? 'day' : 'night'))}
                >
                  {skyMode === 'night' ? 'Day sky' : 'Night sky'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!hasResult}
                  onClick={() => {
                    viewerRef.current?.focus()
                  }}
                >
                  Focus
                </Button>
                {viewerExpanded ? (
                  <Button variant="ghost" size="sm" onClick={() => setViewerExpanded(false)}>
                    Exit fullscreen
                  </Button>
                ) : null}
              </div>
            </div>

            <div
              className={`relative bg-[#14161a] ${
                viewerExpanded
                  ? 'min-h-0 flex-1'
                  : 'min-h-[280px] sm:min-h-[340px]'
              }`}
            >
              {generating ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#14161a]/90">
                  <div className="text-center">
                    <WireframeCube size={72} className="mx-auto animate-pulse" />
                    <p className="mt-4 font-mono text-xs text-accent-warm">Generating asset…</p>
                  </div>
                </div>
              ) : null}

              {hasResult ? (
                <>
                  <ModelViewer3D
                    ref={viewerRef}
                    active={hasResult}
                    modelId={demoModelId}
                    wireframe={wireframe}
                    playing={viewerPlaying && mode === 'animation'}
                    angle={ANGLE_OPTIONS[selectedAngle]?.angle ?? 'threeQuarter'}
                    showGrid={showGrid}
                    lightDirection={lightDirection}
                    lightPosition={lightPosition}
                    skyMode={skyMode}
                    className={viewerExpanded ? 'min-h-0 h-full sm:min-h-0' : ''}
                    onCameraQuaternion={(quaternion) => {
                      cameraQuaternionRef.current.copy(quaternion)
                    }}
                  />
                  <ViewerLightGizmo
                    active={hasResult}
                    lightDirection={lightDirection}
                    onChange={(direction, position) => {
                      setLightDirection(direction)
                      setLightPosition(position)
                    }}
                  />
                  <ViewerViewCube
                    active={hasResult}
                    cameraQuaternionRef={cameraQuaternionRef}
                    gridVisible={showGrid}
                    onSelectAngle={(angle) => {
                      const index = ANGLE_OPTIONS.findIndex((option) => option.angle === angle)
                      if (index >= 0) setSelectedAngle(index)
                    }}
                    onOrbitDelta={(dx, dy) => viewerRef.current?.orbitByDelta(dx, dy)}
                    onZoom={() => viewerRef.current?.zoomIn()}
                    onPan={() => viewerRef.current?.focus()}
                    onCamera={() => {
                      viewerRef.current?.reset()
                      setSelectedAngle(1)
                    }}
                    onToggleGrid={() => setShowGrid((prev) => !prev)}
                  />
                  <button
                    type="button"
                    title={viewerExpanded ? 'Exit fullscreen (Esc)' : 'Enlarge viewer'}
                    aria-label={viewerExpanded ? 'Exit fullscreen' : 'Enlarge viewer'}
                    onClick={() => setViewerExpanded((prev) => !prev)}
                    className="absolute bottom-3 right-3 z-20 flex h-9 w-9 items-center justify-center rounded border border-border/70 bg-[#2a2e36]/95 text-[#d5d8de] transition-colors hover:border-border hover:bg-[#343a44] hover:text-white"
                  >
                    {viewerExpanded ? <MinimizeViewerIcon /> : <EnlargeViewerIcon />}
                  </button>
                  <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded border border-border/60 bg-surface-base/80 px-2 py-1 font-mono text-[10px] text-text-secondary">
                    Drag gizmos to rotate · Click axes to snap
                  </p>
                </>
              ) : (
                <div className="flex min-h-[280px] items-center justify-center sm:min-h-[340px]">
                  <div className="max-w-xs px-4 text-center">
                    <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded border border-dashed border-border">
                      <WireframeCube size={36} className="opacity-40" />
                    </div>
                    <p className="text-sm text-text-secondary">
                      Generated previews and the interactive viewer will appear here.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-border px-3 py-2">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={!hasResult || mode !== 'animation'}
                  onClick={() => setViewerPlaying((prev) => !prev)}
                  className="rounded border border-border px-2.5 py-1 font-mono text-[11px] text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {viewerPlaying ? 'Pause' : 'Play'}
                </button>
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-surface-base">
                  <div
                    className="h-full bg-accent-warm transition-[width] duration-100 ease-linear"
                    style={{ width: `${hasResult ? timeline : 0}%` }}
                  />
                </div>
                <span className="shrink-0 font-mono text-[11px] text-text-secondary">
                  {hasResult ? `${Math.round(timeline)}%` : '0:00'}
                </span>
              </div>
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
                  <p className="mt-1 font-mono text-sm text-text-primary">{stat.value}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={!hasResult}>
                Refine
              </Button>
              <Button variant="primary" disabled={!hasResult}>
                Download
              </Button>
            </div>
          </div>
        </section>

        {/* Right history sidebar */}
        <aside className="flex min-h-[320px] flex-col rounded border border-border bg-surface-elevated/30 xl:min-h-0">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-text-primary">Generation History</h2>
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
                        setHasResult(item.status === 'ready')
                        setGenerating(false)
                        setViewerPlaying(false)
                        setSelectedAngle(1)
                        setWireframe(false)
                        if (item.demoModelId) setDemoModelId(item.demoModelId)
                      }}
                      className="min-w-0 flex-1 px-3 py-2.5 text-left"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm text-text-primary">{item.title}</p>
                        <StatusChip status={item.status} />
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-text-secondary">
                        {item.mode === 'model' ? '3D Model' : 'Animation'} · {item.assetType}
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
                          setHasResult(fallback?.status === 'ready')
                          setViewerPlaying(false)
                          if (!fallback) setWireframe(false)
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

          <div className="border-t border-border p-3">
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => pushLog('info', 'Full library view is not connected yet.')}
            >
              Open complete library
            </Button>
          </div>
        </aside>
      </div>

      {/* Bottom logs */}
      <section className="rounded border border-border bg-surface-elevated/30">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Generation Logs</h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              Timestamped output for this generate session.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={logs.length === 0}
            onClick={() => setLogs([])}
          >
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

function EnlargeViewerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 6V3.5H5M10.5 3.5H13.5V6M13.5 10v2.5H10.5M5 13.5H2.5V10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function MinimizeViewerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M5 2.5V5H2.5M13.5 5H11V2.5M11 13.5V11h2.5M2.5 11H5v2.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
