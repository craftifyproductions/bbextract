import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { ViewerAngle } from './ModelViewer3D'
import {
  Y_UP_TO_Z_UP,
  buildBlenderAxisGizmo,
  type AxisId,
} from './gizmoShared'

interface ViewerViewCubeProps {
  active?: boolean
  cameraQuaternionRef?: React.MutableRefObject<THREE.Quaternion>
  onSelectAngle: (angle: ViewerAngle) => void
  onOrbitDelta?: (dx: number, dy: number) => void
  onZoom?: () => void
  onPan?: () => void
  onCamera?: () => void
  onToggleGrid?: () => void
  gridVisible?: boolean
}

const AXIS_VIEWS: Record<AxisId, ViewerAngle> = {
  '+x': 'side',
  '-x': 'left',
  '+y': 'back',
  '-y': 'front',
  '+z': 'top',
  '-z': 'detail',
}

const DRAG_THRESHOLD_PX = 4

export function ViewerViewCube({
  active = true,
  cameraQuaternionRef,
  onSelectAngle,
  onOrbitDelta,
  onZoom,
  onPan,
  onCamera,
  onToggleGrid,
  gridVisible = true,
}: ViewerViewCubeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onSelectRef = useRef(onSelectAngle)
  const onOrbitRef = useRef(onOrbitDelta)
  onSelectRef.current = onSelectAngle
  onOrbitRef.current = onOrbitDelta

  useEffect(() => {
    const container = containerRef.current
    if (!container || !active) return

    const size = 110
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20)
    camera.position.set(0, 0, 4.8)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(size, size)
    renderer.setClearColor(0x000000, 0)
    container.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.cursor = 'grab'
    renderer.domElement.style.touchAction = 'none'

    const root = new THREE.Group()
    scene.add(root)

    const { gizmo, clickables, dispose: disposeGizmo } = buildBlenderAxisGizmo()
    root.add(gizmo)

    const raycaster = new THREE.Raycaster()
    raycaster.params.Sprite = { threshold: 0.25 }
    const pointer = new THREE.Vector2()
    let frameId = 0
    let disposed = false
    let hovered: THREE.Sprite | null = null

    let dragging = false
    let didDrag = false
    let pointerId: number | null = null
    let startX = 0
    let startY = 0
    let lastX = 0
    let lastY = 0
    let hitAxis: AxisId | null = null

    const animate = () => {
      if (disposed) return
      frameId = window.requestAnimationFrame(animate)
      // While dragging the gizmo, keep the widget stable so it feels like a control handle.
      // Otherwise sync orientation from the main camera.
      if (!dragging) {
        const q = cameraQuaternionRef?.current
        if (q) {
          gizmo.quaternion.copy(q).invert().multiply(Y_UP_TO_Z_UP)
        }
      }
      renderer.render(scene, camera)
    }
    animate()

    const getLocalPoint = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    }

    const setHover = (next: THREE.Sprite | null) => {
      if (hovered === next) return
      if (hovered) {
        const base = Number(hovered.userData.baseScale ?? 0.48)
        hovered.scale.setScalar(base)
      }
      hovered = next
      if (hovered) {
        const base = Number(hovered.userData.baseScale ?? 0.48)
        hovered.scale.setScalar(base * 1.18)
      }
    }

    const pickAxis = (event: PointerEvent): AxisId | null => {
      getLocalPoint(event)
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObjects(clickables, false)
      const obj = hits[0]?.object
      return (obj?.userData.axisId as AxisId | undefined) ?? null
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      dragging = true
      didDrag = false
      pointerId = event.pointerId
      startX = event.clientX
      startY = event.clientY
      lastX = event.clientX
      lastY = event.clientY
      hitAxis = pickAxis(event)
      renderer.domElement.setPointerCapture(event.pointerId)
      renderer.domElement.style.cursor = 'grabbing'
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) {
        const axis = pickAxis(event)
        const sprite = axis
          ? (clickables.find((c) => c.userData.axisId === axis) as THREE.Sprite | undefined)
          : null
        setHover(sprite ?? null)
        renderer.domElement.style.cursor = axis ? 'pointer' : 'grab'
        return
      }

      event.preventDefault()
      const dx = event.clientX - lastX
      const dy = event.clientY - lastY
      lastX = event.clientX
      lastY = event.clientY

      const totalDx = event.clientX - startX
      const totalDy = event.clientY - startY
      if (!didDrag && Math.hypot(totalDx, totalDy) > DRAG_THRESHOLD_PX) {
        didDrag = true
      }
      if (didDrag && (dx !== 0 || dy !== 0)) {
        // Rotate the gizmo itself for immediate feedback
        gizmo.rotation.y += dx * 0.012
        gizmo.rotation.x += dy * 0.012
        onOrbitRef.current?.(dx, dy)
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      if (!dragging || (pointerId !== null && event.pointerId !== pointerId)) return
      dragging = false
      renderer.domElement.style.cursor = 'grab'
      try {
        renderer.domElement.releasePointerCapture(event.pointerId)
      } catch {
        // ignore
      }

      if (!didDrag && hitAxis) {
        onSelectRef.current(AXIS_VIEWS[hitAxis])
      }
      hitAxis = null
      pointerId = null
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)

    return () => {
      disposed = true
      window.cancelAnimationFrame(frameId)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      disposeGizmo()
      renderer.dispose()
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [active, cameraQuaternionRef])

  if (!active) return null

  return (
    <div className="absolute right-2 top-2 z-20 flex flex-col items-center gap-2">
      <div
        ref={containerRef}
        className="h-[110px] w-[110px]"
        title="Drag to orbit · Click an axis to snap"
        aria-label="Orientation gizmo"
      />

      <div className="flex flex-col items-center gap-1.5" role="toolbar" aria-label="Viewport tools">
        <ToolButton title="Zoom in" onClick={onZoom} ariaLabel="Zoom in">
          <ZoomIcon />
        </ToolButton>
        <ToolButton title="Focus pan / frame model" onClick={onPan} ariaLabel="Pan">
          <HandIcon />
        </ToolButton>
        <ToolButton title="Reset camera" onClick={onCamera} ariaLabel="Camera view">
          <CameraIcon />
        </ToolButton>
        <ToolButton
          title={gridVisible ? 'Hide grid' : 'Show grid'}
          onClick={onToggleGrid}
          ariaLabel="Toggle grid"
          active={gridVisible}
        >
          <GridIcon />
        </ToolButton>
      </div>
    </div>
  )
}

function ToolButton({
  children,
  title,
  onClick,
  ariaLabel,
  active = false,
}: {
  children: React.ReactNode
  title: string
  onClick?: () => void
  ariaLabel: string
  active?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
        active
          ? 'border-accent/50 bg-accent/20 text-accent'
          : 'border-border/70 bg-[#2a2e36]/95 text-[#d5d8de] hover:border-border hover:bg-[#343a44] hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

function ZoomIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.2 10.2L13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M7 5v4M5 7h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function HandIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M5.5 7.2V4.2a1 1 0 0 1 2 0v2.2M7.5 6.2V3.4a1 1 0 0 1 2 0v3.2M9.5 6.5V4.3a1 1 0 0 1 2 0V9c0 2.1-1.4 3.7-3.5 3.7-1.7 0-3-.9-3.5-2.3L4 8.2a1 1 0 0 1 1.7-1"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CameraIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1.75" y="4.5" width="9" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M10.8 7.2l3.2-1.6v5.2l-3.2-1.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function GridIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="11" height="11" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M2.5 6.5h11M2.5 10.5h11M6.5 2.5v11M10.5 2.5v11"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}
