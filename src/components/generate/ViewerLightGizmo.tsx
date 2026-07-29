import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { LightDirection } from './demoModel'

interface ViewerLightGizmoProps {
  active?: boolean
  lightDirection: LightDirection
  onChange: (direction: LightDirection, position: [number, number, number]) => void
}

function directionFromSpherical(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180
  const el = (elevationDeg * Math.PI) / 180
  const r = 8
  const x = r * Math.cos(el) * Math.sin(az)
  const y = r * Math.sin(el)
  const z = r * Math.cos(el) * Math.cos(az)
  return [x, y, z]
}

function classifyDirection(azimuthDeg: number, elevationDeg: number): LightDirection {
  if (elevationDeg > 65) return 'top'
  const az = ((azimuthDeg % 360) + 360) % 360
  if (az >= 315 || az < 45) return 'front'
  if (az >= 45 && az < 135) return 'right'
  if (az >= 135 && az < 225) return 'front'
  return 'left'
}

const PRESET_SPHERICAL: Record<LightDirection, { azimuth: number; elevation: number }> = {
  front: { azimuth: 0, elevation: 42 },
  right: { azimuth: 75, elevation: 36 },
  left: { azimuth: -75, elevation: 36 },
  top: { azimuth: 15, elevation: 80 },
}

function makeSunTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(64, 64, 8, 64, 64, 58)
  gradient.addColorStop(0, '#ffe7a8')
  gradient.addColorStop(0.45, '#c4923a')
  gradient.addColorStop(1, 'rgba(196,146,58,0)')
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(64, 64, 58, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#1a1d23'
  ctx.font = 'bold 42px IBM Plex Sans, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('☀', 64, 70)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function ViewerLightGizmo({
  active = true,
  lightDirection,
  onChange,
}: ViewerLightGizmoProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const container = containerRef.current
    if (!container || !active) return

    const size = 118
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 30)
    camera.position.set(0, 0.55, 4.2)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(size, size)
    renderer.setClearColor(0x000000, 0)
    container.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.cursor = 'grab'
    renderer.domElement.style.touchAction = 'none'

    const hemi = new THREE.HemisphereLight(0xffffff, 0x22262e, 1.05)
    scene.add(hemi)
    const fill = new THREE.DirectionalLight(0x4a7fd4, 0.35)
    fill.position.set(-2, 2, 3)
    scene.add(fill)

    const root = new THREE.Group()
    scene.add(root)

    // Dome / trackball shell
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1.15, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.52),
      new THREE.MeshStandardMaterial({
        color: 0x2a303a,
        transparent: true,
        opacity: 0.35,
        roughness: 0.85,
        metalness: 0.05,
        side: THREE.DoubleSide,
      }),
    )
    root.add(dome)

    // Latitude rings
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x4a7fd4,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
    })
    const equator = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.015, 8, 64), ringMat)
    equator.rotation.x = Math.PI / 2
    root.add(equator)

    const midRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.95, 0.012, 8, 64),
      new THREE.MeshBasicMaterial({
        color: 0x8b919a,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      }),
    )
    midRing.rotation.x = Math.PI / 2
    midRing.position.y = 0.45
    root.add(midRing)

    // Meridian arc (elevation guide)
    const meridian = new THREE.Mesh(
      new THREE.TorusGeometry(1.15, 0.012, 8, 64, Math.PI),
      new THREE.MeshBasicMaterial({
        color: 0xc4923a,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
      }),
    )
    meridian.rotation.y = Math.PI / 2
    root.add(meridian)

    // Ground disc + tiny subject
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 28),
      new THREE.MeshStandardMaterial({ color: 0x1a1d23, roughness: 0.95 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.02
    root.add(ground)

    const subject = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.38, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x6b7280, flatShading: true }),
    )
    subject.position.y = 0.2
    root.add(subject)

    // Draggable sun handle
    const sunGroup = new THREE.Group()
    root.add(sunGroup)

    const sunSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeSunTexture(),
        transparent: true,
        depthTest: false,
      }),
    )
    sunSprite.scale.set(0.55, 0.55, 1)
    sunGroup.add(sunSprite)

    const beamMat = new THREE.LineBasicMaterial({
      color: 0xc4923a,
      transparent: true,
      opacity: 0.75,
    })
    const beamGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1, 0),
    ])
    const beam = new THREE.Line(beamGeom, beamMat)
    root.add(beam)

    let azimuth = PRESET_SPHERICAL[lightDirection].azimuth
    let elevation = PRESET_SPHERICAL[lightDirection].elevation
    let dragging = false
    let frameId = 0
    let disposed = false

    const placeSun = () => {
      const az = (azimuth * Math.PI) / 180
      const el = (elevation * Math.PI) / 180
      const x = Math.cos(el) * Math.sin(az)
      const y = Math.sin(el)
      const z = Math.cos(el) * Math.cos(az)
      const dir = new THREE.Vector3(x, y, z).normalize()
      sunGroup.position.copy(dir.multiplyScalar(1.2))

      const positions = beam.geometry.attributes.position as THREE.BufferAttribute
      positions.setXYZ(0, 0, 0.22, 0)
      positions.setXYZ(1, sunGroup.position.x * 0.88, sunGroup.position.y * 0.88, sunGroup.position.z * 0.88)
      positions.needsUpdate = true

      meridian.rotation.y = az + Math.PI / 2
    }
    placeSun()

    const emit = () => {
      onChangeRef.current(
        classifyDirection(azimuth, elevation),
        directionFromSpherical(azimuth, elevation),
      )
    }

    const animate = () => {
      if (disposed) return
      frameId = window.requestAnimationFrame(animate)
      if (!dragging) {
        root.rotation.y += 0.0035
      }
      renderer.render(scene, camera)
    }
    animate()

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      dragging = true
      root.rotation.y = 0
      renderer.domElement.setPointerCapture(event.pointerId)
      renderer.domElement.style.cursor = 'grabbing'
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return
      event.preventDefault()
      azimuth += event.movementX * 0.8
      elevation = Math.min(88, Math.max(6, elevation - event.movementY * 0.65))
      placeSun()
      emit()
    }

    const onPointerUp = (event: PointerEvent) => {
      if (!dragging) return
      dragging = false
      renderer.domElement.style.cursor = 'grab'
      try {
        renderer.domElement.releasePointerCapture(event.pointerId)
      } catch {
        // ignore
      }
    }

    const onDoubleClick = (event: PointerEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const order: LightDirection[] = ['front', 'right', 'top', 'left']
      const current = classifyDirection(azimuth, elevation)
      const next = order[(order.indexOf(current) + 1) % order.length] ?? 'front'
      azimuth = PRESET_SPHERICAL[next].azimuth
      elevation = PRESET_SPHERICAL[next].elevation
      placeSun()
      emit()
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointercancel', onPointerUp)
    renderer.domElement.addEventListener('dblclick', onDoubleClick)

    return () => {
      disposed = true
      window.cancelAnimationFrame(frameId)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointercancel', onPointerUp)
      renderer.domElement.removeEventListener('dblclick', onDoubleClick)
      renderer.dispose()
      beamGeom.dispose()
      beamMat.dispose()
      sunSprite.material.map?.dispose()
      sunSprite.material.dispose()
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
  }, [active])

  if (!active) return null

  return (
    <div
      className="absolute left-2 top-2 z-20 flex flex-col items-center"
      title="Drag to aim the sun · Double-click to cycle presets"
    >
      <div
        ref={containerRef}
        className="h-[118px] w-[118px] rounded-full border border-border/40 bg-surface-base/30 shadow-lg backdrop-blur-sm"
        aria-label="Light direction trackball"
      />
      <p className="pointer-events-none mt-1 font-mono text-[9px] uppercase tracking-wide text-text-secondary">
        Light
      </p>
    </div>
  )
}
