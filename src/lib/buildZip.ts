import JSZip from 'jszip'
import { modelDataStore } from './modelDataStore'
import type { ProcessedModel } from './types'

function addModelToZip(zip: JSZip, model: ProcessedModel): void {
  const root = zip.folder(model.folderName)
  if (!root) return

  const heavyData = modelDataStore.ensureHeavyData(model.id, model.rawText)
  if (!heavyData) return

  const { geometry, animations, textures } = heavyData

  root.file('metadata.json', JSON.stringify(model.metadata, null, 2))

  const geometryFolder = root.folder('geometry')
  geometryFolder?.file('elements.json', JSON.stringify(geometry.elements, null, 2))
  geometryFolder?.file('outliner.json', JSON.stringify(geometry.outliner, null, 2))

  const texturesFolder = root.folder('textures')
  const texturesManifest = textures.map((texture) => ({
    uuid: texture.uuid,
    name: texture.name,
    id: texture.id,
    width: texture.width,
    height: texture.height,
    filename: texture.filename,
  }))

  for (const texture of textures) {
    texturesFolder?.file(texture.filename, texture.blob)
  }
  texturesFolder?.file('textures_manifest.json', JSON.stringify(texturesManifest, null, 2))

  const animationsFolder = root.folder('animations')
  const animationsManifest = animations.map((animation) => ({
    name: animation.name,
    length: animation.length,
    loop: animation.loop,
    keyframeCount: animation.keyframeCount,
    filename: animation.filename,
  }))

  for (const animation of animations) {
    animationsFolder?.file(animation.filename, JSON.stringify(animation.data, null, 2))
  }
  animationsFolder?.file(
    'animations_manifest.json',
    JSON.stringify(animationsManifest, null, 2),
  )

  root.file('summary.json', JSON.stringify(model.summary, null, 2))
}

export async function buildModelZip(model: ProcessedModel): Promise<Blob> {
  const zip = new JSZip()
  addModelToZip(zip, model)
  return zip.generateAsync({ type: 'blob' })
}

export async function buildAllModelsZip(models: ProcessedModel[]): Promise<Blob> {
  const zip = new JSZip()
  const doneModels = models.filter((model) => model.status === 'done')

  for (const model of doneModels) {
    addModelToZip(zip, model)
  }

  return zip.generateAsync({ type: 'blob' })
}
