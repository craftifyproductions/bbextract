import * as THREE from 'three'

export type AxisId = '+x' | '-x' | '+y' | '-y' | '+z' | '-z'

export function makeAxisLabelTexture(
  label: string,
  fill: string,
  textColor: string,
  outlined: boolean,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, 128, 128)

  if (outlined) {
    ctx.beginPath()
    ctx.arc(64, 64, 50, 0, Math.PI * 2)
    ctx.strokeStyle = fill
    ctx.lineWidth = 10
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.arc(64, 64, 54, 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.fill()
    ctx.fillStyle = textColor
    ctx.font = 'bold 64px IBM Plex Sans, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, 64, 70)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

export function createAxisTip(
  label: string,
  color: string,
  outlined: boolean,
  axisId: AxisId | 'light',
): THREE.Sprite {
  const texture = makeAxisLabelTexture(label, color, '#111111', outlined)
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const sprite = new THREE.Sprite(material)
  const scale = outlined ? 0.38 : 0.48
  sprite.scale.set(scale, scale, 1)
  sprite.userData.axisId = axisId
  sprite.userData.baseScale = scale
  sprite.userData.clickable = true
  return sprite
}

export function buildBlenderAxisGizmo(options?: {
  includeNegatives?: boolean
  axisLength?: number
}): { gizmo: THREE.Group; clickables: THREE.Object3D[]; dispose: () => void } {
  const includeNegatives = options?.includeNegatives ?? true
  const axisLength = options?.axisLength ?? 0.85
  const gizmo = new THREE.Group()
  const clickables: THREE.Object3D[] = []
  const lineMats: THREE.LineBasicMaterial[] = []

  const axes: {
    id: AxisId
    dir: [number, number, number]
    color: string
    label: string
    positive: boolean
  }[] = [
    { id: '+x', dir: [1, 0, 0], color: '#e74c3c', label: 'X', positive: true },
    { id: '-x', dir: [-1, 0, 0], color: '#e74c3c', label: 'X', positive: false },
    { id: '+y', dir: [0, 1, 0], color: '#2ecc71', label: 'Y', positive: true },
    { id: '-y', dir: [0, -1, 0], color: '#2ecc71', label: 'Y', positive: false },
    { id: '+z', dir: [0, 0, 1], color: '#3498db', label: 'Z', positive: true },
    { id: '-z', dir: [0, 0, -1], color: '#3498db', label: 'Z', positive: false },
  ]

  for (const axis of axes) {
    if (!axis.positive && !includeNegatives) continue
    const dir = new THREE.Vector3(...axis.dir)

    if (axis.positive) {
      const mat = new THREE.LineBasicMaterial({ color: axis.color })
      lineMats.push(mat)
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          dir.clone().multiplyScalar(axisLength),
        ]),
        mat,
      )
      gizmo.add(line)
    }

    const tip = createAxisTip(axis.label, axis.color, !axis.positive, axis.id)
    tip.position.copy(dir.multiplyScalar(axis.positive ? 1.15 : 1.05))
    gizmo.add(tip)
    clickables.push(tip)
  }

  const hub = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0x9aa0a8 }),
  )
  gizmo.add(hub)

  return {
    gizmo,
    clickables,
    dispose: () => {
      for (const mat of lineMats) mat.dispose()
      gizmo.traverse((object) => {
        if (object instanceof THREE.Line) object.geometry.dispose()
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          for (const material of materials) material.dispose()
        }
        if (object instanceof THREE.Sprite) {
          object.material.map?.dispose()
          object.material.dispose()
        }
      })
    },
  }
}

/** Convert Three.js Y-up camera rotation into Blender-like Z-up gizmo orientation. */
export const Y_UP_TO_Z_UP = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
