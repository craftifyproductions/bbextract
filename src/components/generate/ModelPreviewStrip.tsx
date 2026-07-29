import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { createDemoModel, frameOrthographicPreview, type DemoModelId, type PreviewViewDirection } from './demoModel'
import type { ViewerAngle } from './ModelViewer3D'

export type PreviewViewId = 'front' | 'top' | 'left' | 'right'

const PREVIEW_VIEWS: {
  id: PreviewViewId
  label: string
  angle: ViewerAngle
  view: PreviewViewDirection
}[] = [
  { id: 'front', label: 'Front', angle: 'front', view: 'front' },
  { id: 'top', label: 'Top', angle: 'top', view: 'top' },
  { id: 'left', label: 'Left', angle: 'left', view: 'left' },
  { id: 'right', label: 'Right', angle: 'side', view: 'right' },
]

interface ModelPreviewStripProps {
  active: boolean
  modelId: DemoModelId
  selectedAngle: ViewerAngle
  onSelectView: (view: PreviewViewId, angle: ViewerAngle) => void
}

export function ModelPreviewStrip({ active, modelId, selectedAngle, onSelectView }: ModelPreviewStripProps) {
  if (!active) {
    return (
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-text-secondary">Orthographic previews</p>
          <span className="font-mono text-[11px] text-text-secondary">Awaiting generation</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PREVIEW_VIEWS.map((view) => (
            <div
              key={view.id}
              className="aspect-square rounded border border-dashed border-border bg-surface-elevated/20"
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-text-secondary">Orthographic previews</p>
        <span className="font-mono text-[11px] text-text-secondary">Front · Top · Left · Right</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PREVIEW_VIEWS.map((view) => {
          const isSelected = selectedAngle === view.angle

          return (
            <button
              key={view.id}
              type="button"
              onClick={() => onSelectView(view.id, view.angle)}
              className={`group overflow-hidden rounded border text-left transition-colors ${
                isSelected
                  ? 'border-accent/50 bg-accent/10'
                  : 'border-border bg-surface-elevated/40 hover:border-border hover:bg-surface-elevated'
              }`}
            >
              <div className="relative aspect-square bg-[#14161a]">
                <PreviewTile modelId={modelId} view={view.view} />
                <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded border border-border/60 bg-surface-base/80 px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                  {view.label}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PreviewTile({ modelId, view }: { modelId: DemoModelId; view: PreviewViewDirection }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const size = Math.max(container.clientWidth, 120)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x14161a)

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(size, size)
    container.appendChild(renderer.domElement)

    const hemi = new THREE.HemisphereLight(0xdde6ff, 0x1a1d23, 0.95)
    scene.add(hemi)
    const key = new THREE.DirectionalLight(0xffffff, 1.15)
    key.position.set(3, 6, 4)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0x4a7fd4, 0.35)
    fill.position.set(-3, 2, -2)
    scene.add(fill)

    const model = createDemoModel(modelId)
    scene.add(model)

    frameOrthographicPreview(camera, model, view)
    renderer.render(scene, camera)

    const resizeObserver = new ResizeObserver(() => {
      const next = container.clientWidth
      if (next < 2) return
      renderer.setSize(next, next)
      frameOrthographicPreview(camera, model, view)
      renderer.render(scene, camera)
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      renderer.dispose()
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          for (const material of materials) material.dispose()
        }
      })
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [modelId, view])

  return <div ref={containerRef} className="h-full w-full" aria-hidden />
}
