import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  applySkyMode,
  createDemoModel,
  LIGHT_POSITIONS,
  setMaterialsWireframe,
  type DemoModelId,
  type LightDirection,
  type SkyMode,
} from './demoModel'

export type ViewerAngle = 'front' | 'threeQuarter' | 'side' | 'left' | 'back' | 'top' | 'detail'

export interface ModelViewer3DHandle {
  reset: () => void
  focus: () => void
  zoomIn: () => void
  orbitByDelta: (dx: number, dy: number) => void
  setWireframe: (enabled: boolean) => void
  toggleWireframe: () => boolean
}

interface ModelViewer3DProps {
  active?: boolean
  modelId?: DemoModelId
  wireframe?: boolean
  playing?: boolean
  angle?: ViewerAngle
  showGrid?: boolean
  lightDirection?: LightDirection
  lightPosition?: [number, number, number] | null
  skyMode?: SkyMode
  onCameraQuaternion?: (quaternion: THREE.Quaternion) => void
  className?: string
}

const ANGLE_PRESETS: Record<
  ViewerAngle,
  { position: [number, number, number]; target: [number, number, number] }
> = {
  front: { position: [0, 1.2, 4.2], target: [0, 0.6, 0] },
  threeQuarter: { position: [3.2, 1.6, 3.2], target: [0, 0.6, 0] },
  side: { position: [4.4, 1.2, 0], target: [0, 0.6, 0] },
  left: { position: [-4.4, 1.2, 0], target: [0, 0.6, 0] },
  back: { position: [0, 1.2, -4.2], target: [0, 0.6, 0] },
  top: { position: [0.1, 5.5, 0.1], target: [0, 0.4, 0] },
  detail: { position: [1.4, 1.5, 1.8], target: [0, 0.9, 0] },
}

export const ModelViewer3D = forwardRef<ModelViewer3DHandle, ModelViewer3DProps>(
  function ModelViewer3D(
    {
      active = true,
      modelId = 'character',
      wireframe = false,
      playing = false,
      angle = 'front',
      showGrid = true,
      lightDirection = 'front',
      lightPosition = null,
      skyMode = 'night',
      onCameraQuaternion,
      className = '',
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null)
    const onCameraQuaternionRef = useRef(onCameraQuaternion)
    onCameraQuaternionRef.current = onCameraQuaternion
    const apiRef = useRef<{
      reset: () => void
      focus: () => void
      zoomIn: () => void
      orbitByDelta: (dx: number, dy: number) => void
      setWireframe: (enabled: boolean) => void
      toggleWireframe: () => boolean
      setAngle: (next: ViewerAngle) => void
      setPlaying: (next: boolean) => boolean
      setShowGrid: (enabled: boolean) => void
      setLightDirection: (direction: LightDirection) => void
      setLightPosition: (position: [number, number, number] | null) => void
      setSkyMode: (mode: SkyMode) => void
    } | null>(null)

    useImperativeHandle(ref, () => ({
      reset: () => apiRef.current?.reset(),
      focus: () => apiRef.current?.focus(),
      zoomIn: () => apiRef.current?.zoomIn(),
      orbitByDelta: (dx: number, dy: number) => apiRef.current?.orbitByDelta(dx, dy),
      setWireframe: (enabled: boolean) => apiRef.current?.setWireframe(enabled),
      toggleWireframe: () => apiRef.current?.toggleWireframe() ?? false,
    }))

    useEffect(() => {
      const container = containerRef.current
      if (!container || !active) return

      const width = container.clientWidth || 640
      const height = container.clientHeight || 340

      const scene = new THREE.Scene()

      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100)
      camera.position.set(3.2, 1.6, 3.2)

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(width, height)
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      container.appendChild(renderer.domElement)

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = 0.08
      controls.enablePan = true
      controls.enableZoom = true
      controls.enableRotate = true
      controls.screenSpacePanning = true
      controls.minDistance = 1.2
      controls.maxDistance = 12
      controls.maxPolarAngle = Math.PI * 0.92
      controls.target.set(0, 0.6, 0)
      controls.update()

      const hemi = new THREE.HemisphereLight(0xdde6ff, 0x1a1d23, 0.85)
      scene.add(hemi)

      const key = new THREE.DirectionalLight(0xffffff, 1.15)
      const initialLight = lightPosition ?? LIGHT_POSITIONS[lightDirection]
      key.position.set(...initialLight)
      key.castShadow = true
      key.shadow.mapSize.set(1024, 1024)
      scene.add(key)

      const fill = new THREE.DirectionalLight(0x4a7fd4, 0.35)
      fill.position.set(-4, 2, -3)
      scene.add(fill)

      const grid = new THREE.GridHelper(10, 20, 0x2e3340, 0x22262e)
      grid.position.y = 0
      grid.visible = showGrid
      scene.add(grid)

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 20),
        new THREE.MeshStandardMaterial({
          color: 0x1a1d23,
          metalness: 0,
          roughness: 1,
        }),
      )
      ground.rotation.x = -Math.PI / 2
      ground.position.y = -0.001
      ground.receiveShadow = true
      scene.add(ground)

      applySkyMode(scene, hemi, key, fill, ground, skyMode)

      const model = createDemoModel(modelId)
      scene.add(model)
      setMaterialsWireframe(model, wireframe)

      let wireframeEnabled = wireframe
      let isPlaying = playing
      let frameId = 0
      let disposed = false

      const defaultPreset = ANGLE_PRESETS.threeQuarter

      const applyCamera = (
        position: [number, number, number],
        target: [number, number, number],
      ) => {
        camera.position.set(...position)
        controls.target.set(...target)
        controls.update()
      }

      applyCamera(defaultPreset.position, defaultPreset.target)

      const focusObject = () => {
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z, 1)
        const distance = maxDim * 2.4
        const direction = new THREE.Vector3()
          .subVectors(camera.position, controls.target)
          .normalize()
        camera.position.copy(center).addScaledVector(direction, distance)
        controls.target.copy(center)
        controls.update()
      }

      apiRef.current = {
        reset: () => {
          model.rotation.set(0, 0, 0)
          model.position.set(0, 0, 0)
          applyCamera(defaultPreset.position, defaultPreset.target)
        },
        focus: () => focusObject(),
        zoomIn: () => {
          const offset = new THREE.Vector3().subVectors(camera.position, controls.target)
          const distance = offset.length()
          const next = Math.max(controls.minDistance + 0.05, distance * 0.82)
          offset.setLength(next)
          camera.position.copy(controls.target).add(offset)
          controls.update()
        },
        orbitByDelta: (dx: number, dy: number) => {
          // Direct spherical orbit — bypass damping so gizmo drag feels immediate.
          const prevDamping = controls.enableDamping
          controls.enableDamping = false
          const offset = new THREE.Vector3().subVectors(camera.position, controls.target)
          const spherical = new THREE.Spherical().setFromVector3(offset)
          const speed = 0.014
          spherical.theta -= dx * speed
          spherical.phi = THREE.MathUtils.clamp(
            spherical.phi - dy * speed,
            0.05,
            Math.PI - 0.05,
          )
          offset.setFromSpherical(spherical)
          camera.position.copy(controls.target).add(offset)
          camera.lookAt(controls.target)
          controls.update()
          controls.enableDamping = prevDamping
        },
        setWireframe: (enabled: boolean) => {
          wireframeEnabled = enabled
          setMaterialsWireframe(model, enabled)
        },
        toggleWireframe: () => {
          wireframeEnabled = !wireframeEnabled
          setMaterialsWireframe(model, wireframeEnabled)
          return wireframeEnabled
        },
        setAngle: (next: ViewerAngle) => {
          const preset = ANGLE_PRESETS[next]
          applyCamera(preset.position, preset.target)
        },
        setPlaying: (next: boolean) => {
          isPlaying = next
          return isPlaying
        },
        setShowGrid: (enabled: boolean) => {
          grid.visible = enabled
        },
        setLightDirection: (direction: LightDirection) => {
          key.position.set(...LIGHT_POSITIONS[direction])
        },
        setLightPosition: (position: [number, number, number] | null) => {
          if (position) key.position.set(...position)
        },
        setSkyMode: (mode: SkyMode) => {
          applySkyMode(scene, hemi, key, fill, ground, mode)
        },
      }

      const clock = new THREE.Clock()
      const quatScratch = new THREE.Quaternion()

      const animate = () => {
        if (disposed) return
        frameId = window.requestAnimationFrame(animate)
        const elapsed = clock.getElapsedTime()

        if (isPlaying) {
          model.rotation.y = Math.sin(elapsed * 1.2) * 0.35
          model.position.y = Math.sin(elapsed * 2.4) * 0.05
        }

        controls.update()
        onCameraQuaternionRef.current?.(quatScratch.copy(camera.quaternion))
        renderer.render(scene, camera)
      }
      animate()

      const resizeObserver = new ResizeObserver(() => {
        if (!container || disposed) return
        const nextWidth = container.clientWidth
        const nextHeight = container.clientHeight
        if (nextWidth < 2 || nextHeight < 2) return
        camera.aspect = nextWidth / nextHeight
        camera.updateProjectionMatrix()
        renderer.setSize(nextWidth, nextHeight)
      })
      resizeObserver.observe(container)

      return () => {
        disposed = true
        window.cancelAnimationFrame(frameId)
        resizeObserver.disconnect()
        controls.dispose()
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
        apiRef.current = null
      }
      // Intentionally mount once while active; prop sync happens in separate effects.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, modelId])

    useEffect(() => {
      apiRef.current?.setWireframe(wireframe)
    }, [wireframe])

    useEffect(() => {
      apiRef.current?.setPlaying(playing)
    }, [playing])

    useEffect(() => {
      apiRef.current?.setAngle(angle)
    }, [angle])

    useEffect(() => {
      apiRef.current?.setShowGrid(showGrid)
    }, [showGrid])

    useEffect(() => {
      if (lightPosition) {
        apiRef.current?.setLightPosition(lightPosition)
      } else {
        apiRef.current?.setLightDirection(lightDirection)
      }
    }, [lightDirection, lightPosition])

    useEffect(() => {
      apiRef.current?.setSkyMode(skyMode)
    }, [skyMode])

    return (
      <div
        ref={containerRef}
        className={`relative h-full min-h-[280px] w-full touch-none sm:min-h-[340px] ${className}`}
        aria-label="3D model viewer"
      />
    )
  },
)
