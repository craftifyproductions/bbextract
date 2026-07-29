import * as THREE from 'three'

export type DemoModelId = 'character' | 'creature'

export interface DemoModelOption {
  id: DemoModelId
  label: string
  description: string
  metadata: { label: string; value: string }[]
}

export const DEMO_MODELS: DemoModelOption[] = [
  {
    id: 'character',
    label: 'Block character',
    description: 'Humanoid rig placeholder',
    metadata: [
      { label: 'Vertices', value: '12,480' },
      { label: 'Triangles', value: '24,910' },
      { label: 'Bones', value: '42' },
      { label: 'File size', value: '3.2 MB' },
    ],
  },
  {
    id: 'creature',
    label: 'Fox creature',
    description: 'Quadruped creature placeholder',
    metadata: [
      { label: 'Vertices', value: '9,840' },
      { label: 'Triangles', value: '19,620' },
      { label: 'Bones', value: '28' },
      { label: 'File size', value: '2.6 MB' },
    ],
  },
]

export function createDemoModel(id: DemoModelId = 'character'): THREE.Group {
  return id === 'creature' ? createFoxCreature() : createBlockCharacter()
}

function createBlockCharacter(): THREE.Group {
  const root = new THREE.Group()
  root.name = 'demo-model'

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x4a7fd4,
    metalness: 0.15,
    roughness: 0.55,
    flatShading: true,
  })
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xc4923a,
    metalness: 0.2,
    roughness: 0.45,
    flatShading: true,
  })
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x2e3340,
    metalness: 0.1,
    roughness: 0.7,
    flatShading: true,
  })

  const torso = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.4, 0.7), bodyMat)
  torso.position.y = 1.1
  torso.castShadow = true
  root.add(torso)

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), accentMat)
  head.position.y = 2.15
  head.castShadow = true
  root.add(head)

  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.05, 0.28), bodyMat)
  leftArm.position.set(-0.85, 1.15, 0)
  leftArm.castShadow = true
  root.add(leftArm)

  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.05, 0.28), bodyMat)
  rightArm.position.set(0.85, 1.15, 0)
  rightArm.castShadow = true
  root.add(rightArm)

  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.1, 0.35), darkMat)
  leftLeg.position.set(-0.32, 0.2, 0)
  leftLeg.castShadow = true
  root.add(leftLeg)

  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.1, 0.35), darkMat)
  rightLeg.position.set(0.32, 0.2, 0)
  rightLeg.castShadow = true
  root.add(rightLeg)

  return root
}

function createFoxCreature(): THREE.Group {
  const root = new THREE.Group()
  root.name = 'demo-creature'

  const furMat = new THREE.MeshStandardMaterial({
    color: 0xc46a2b,
    metalness: 0.08,
    roughness: 0.62,
    flatShading: true,
  })
  const bellyMat = new THREE.MeshStandardMaterial({
    color: 0xf0dcc0,
    metalness: 0.05,
    roughness: 0.68,
    flatShading: true,
  })
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x2a1f18,
    metalness: 0.1,
    roughness: 0.72,
    flatShading: true,
  })
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.05,
    roughness: 0.55,
    flatShading: true,
  })

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.75, 1.65), furMat)
  body.position.set(0, 0.82, 0)
  body.castShadow = true
  root.add(body)

  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.42, 1.25), bellyMat)
  belly.position.set(0, 0.58, 0.02)
  belly.castShadow = true
  root.add(belly)

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.58, 0.72), furMat)
  head.position.set(0, 1.02, 1.05)
  head.castShadow = true
  root.add(head)

  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 0.42), bellyMat)
  snout.position.set(0, 0.9, 1.45)
  snout.castShadow = true
  root.add(snout)

  const leftEar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.42, 0.12), furMat)
  leftEar.position.set(-0.22, 1.38, 0.92)
  leftEar.castShadow = true
  root.add(leftEar)

  const rightEar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.42, 0.12), furMat)
  rightEar.position.set(0.22, 1.38, 0.92)
  rightEar.castShadow = true
  root.add(rightEar)

  const leftEye = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.06), accentMat)
  leftEye.position.set(-0.16, 1.06, 1.38)
  root.add(leftEye)

  const rightEye = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.06), accentMat)
  rightEye.position.set(0.16, 1.06, 1.38)
  root.add(rightEye)

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.95), furMat)
  tail.position.set(0, 0.98, -1.05)
  tail.castShadow = true
  root.add(tail)

  const tailTip = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.28), accentMat)
  tailTip.position.set(0, 0.98, -1.55)
  tailTip.castShadow = true
  root.add(tailTip)

  const legGeo = new THREE.BoxGeometry(0.22, 0.62, 0.26)
  const legPositions: [number, number, number][] = [
    [-0.34, 0.31, 0.55],
    [0.34, 0.31, 0.55],
    [-0.34, 0.31, -0.55],
    [0.34, 0.31, -0.55],
  ]
  for (const position of legPositions) {
    const leg = new THREE.Mesh(legGeo, darkMat)
    leg.position.set(...position)
    leg.castShadow = true
    root.add(leg)
  }

  return root
}

export type PreviewViewDirection = 'front' | 'top' | 'left' | 'right'

/** Frame an orthographic camera so the entire object fits in a square tile. */
export function frameOrthographicPreview(
  camera: THREE.OrthographicCamera,
  object: THREE.Object3D,
  view: PreviewViewDirection,
  padding = 1.18,
) {
  const box = new THREE.Box3().setFromObject(object)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())

  let halfW: number
  let halfH: number
  let eye: THREE.Vector3
  let up: THREE.Vector3

  switch (view) {
    case 'front':
      halfW = size.x / 2
      halfH = size.y / 2
      eye = center.clone().add(new THREE.Vector3(0, 0, 10))
      up = new THREE.Vector3(0, 1, 0)
      break
    case 'top':
      halfW = size.x / 2
      halfH = size.z / 2
      eye = center.clone().add(new THREE.Vector3(0, 10, 0))
      up = new THREE.Vector3(0, 0, -1)
      break
    case 'left':
      halfW = size.z / 2
      halfH = size.y / 2
      eye = center.clone().add(new THREE.Vector3(-10, 0, 0))
      up = new THREE.Vector3(0, 1, 0)
      break
    case 'right':
      halfW = size.z / 2
      halfH = size.y / 2
      eye = center.clone().add(new THREE.Vector3(10, 0, 0))
      up = new THREE.Vector3(0, 1, 0)
      break
  }

  const halfExtent = Math.max(halfW, halfH) * padding
  camera.left = -halfExtent
  camera.right = halfExtent
  camera.top = halfExtent
  camera.bottom = -halfExtent
  camera.near = 0.1
  camera.far = 100
  camera.position.copy(eye)
  camera.up.copy(up)
  camera.lookAt(center)
  camera.updateProjectionMatrix()
}

export function setMaterialsWireframe(object: THREE.Object3D, enabled: boolean) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if (material && 'wireframe' in material) {
        material.wireframe = enabled
        material.needsUpdate = true
      }
    }
  })
}

export type LightDirection = 'front' | 'left' | 'right' | 'top'
export type SkyMode = 'day' | 'night'

export const LIGHT_DIRECTIONS: LightDirection[] = ['front', 'left', 'right', 'top']

export const LIGHT_POSITIONS: Record<LightDirection, [number, number, number]> = {
  front: [0, 6, 8],
  left: [-8, 5, 2],
  right: [8, 5, 2],
  top: [1, 10, 1],
}

export function applySkyMode(
  scene: THREE.Scene,
  hemi: THREE.HemisphereLight,
  key: THREE.DirectionalLight,
  fill: THREE.DirectionalLight,
  ground: THREE.Mesh,
  mode: SkyMode,
) {
  if (mode === 'day') {
    scene.background = new THREE.Color(0x87b5e0)
    scene.fog = new THREE.Fog(0x9ec5e8, 10, 22)
    hemi.color.set(0xfff4e0)
    hemi.groundColor.set(0x8fa88a)
    hemi.intensity = 1.05
    key.color.set(0xfff6e8)
    key.intensity = 1.35
    fill.color.set(0x6ea0d8)
    fill.intensity = 0.4
    if (ground.material instanceof THREE.MeshStandardMaterial) {
      ground.material.color.set(0xd6d2c4)
    }
  } else {
    scene.background = new THREE.Color(0x14161a)
    scene.fog = new THREE.Fog(0x14161a, 8, 18)
    hemi.color.set(0xdde6ff)
    hemi.groundColor.set(0x1a1d23)
    hemi.intensity = 0.85
    key.color.set(0xffffff)
    key.intensity = 1.15
    fill.color.set(0x4a7fd4)
    fill.intensity = 0.35
    if (ground.material instanceof THREE.MeshStandardMaterial) {
      ground.material.color.set(0x1a1d23)
    }
  }
}
