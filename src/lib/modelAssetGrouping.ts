import type { DirectUploadAssetItem, ProcessedModel } from './types'

const UNASSIGNED_FOLDER = '_unassigned'

function sanitizePathPart(value: string): string {
  return value.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'file'
}

export function zipArchiveFolderName(sourceArchive: string): string {
  const sourceName = sourceArchive.replace(/\.zip$/i, '') || 'archive'
  return sanitizePathPart(sourceName)
}

function basenameWithoutExtension(name: string): string {
  const lastSlash = name.lastIndexOf('/')
  const base = lastSlash >= 0 ? name.slice(lastSlash + 1) : name
  const lastDot = base.lastIndexOf('.')
  return (lastDot > 0 ? base.slice(0, lastDot) : base).toLowerCase()
}

function stripZipEntryPrefix(filename: string, zipArchive: string): string {
  const zipBase = sanitizePathPart(zipArchive.replace(/\.zip$/i, ''))
  const prefix = `${zipBase}__`.toLowerCase()
  const lower = filename.toLowerCase()
  if (lower.startsWith(prefix)) return lower.slice(prefix.length)
  return lower
}

function pathDirname(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  return lastSlash >= 0 ? normalized.slice(0, lastSlash).toLowerCase() : ''
}

function modelsFromSameArchive(
  asset: DirectUploadAssetItem,
  models: ProcessedModel[],
): ProcessedModel[] {
  if (!asset.sourceArchive) return models
  return models.filter((model) => model.sourceArchive === asset.sourceArchive)
}

/** Match a loose ZIP texture/json file to a processed model folder name. */
export function resolveModelFolderForAsset(
  asset: DirectUploadAssetItem,
  models: ProcessedModel[],
): string | null {
  const candidates = modelsFromSameArchive(asset, models).filter((model) => model.status === 'done')
  if (candidates.length === 0) return null

  const zipArchive = asset.sourceArchive ?? ''
  const assetStem = stripZipEntryPrefix(basenameWithoutExtension(asset.file.name), zipArchive)
  const assetDir = asset.originalPath ? pathDirname(asset.originalPath) : ''

  for (const model of candidates) {
    const modelStem = stripZipEntryPrefix(
      basenameWithoutExtension(model.originalFilename),
      zipArchive,
    )
    const modelDir = model.originalPath ? pathDirname(model.originalPath) : ''

    if (assetStem && modelStem && assetStem === modelStem) {
      return model.folderName
    }

    if (assetDir && modelDir && assetDir === modelDir) {
      return model.folderName
    }

    if (
      assetStem &&
      modelStem &&
      (assetStem.startsWith(`${modelStem}_`) ||
        modelStem.startsWith(`${assetStem}_`) ||
        assetStem.includes(modelStem) ||
        modelStem.includes(assetStem))
    ) {
      return model.folderName
    }
  }

  return null
}

export function buildModelStorageRoot(
  runFolder: string,
  model: Pick<ProcessedModel, 'folderName' | 'sourceArchive'>,
): string {
  const modelPath = sanitizePathPart(model.folderName)
  if (model.sourceArchive) {
    return `${runFolder}/${zipArchiveFolderName(model.sourceArchive)}/${modelPath}`
  }
  return `${runFolder}/${modelPath}`
}

export interface GroupedAssetLocation {
  storagePath: string
  modelName: string
}

export function buildGroupedAssetLocation(
  runFolder: string,
  asset: DirectUploadAssetItem,
  models: ProcessedModel[],
): GroupedAssetLocation {
  const filename = sanitizePathPart(asset.file.name)

  if (asset.sourceArchive) {
    const archiveRoot = zipArchiveFolderName(asset.sourceArchive)
    const modelFolder = resolveModelFolderForAsset(asset, models)
    if (modelFolder) {
      const modelPath = sanitizePathPart(modelFolder)
      return {
        storagePath: `${runFolder}/${archiveRoot}/${modelPath}/${asset.assetKind}/${filename}`,
        modelName: modelFolder,
      }
    }
    return {
      storagePath: `${runFolder}/${archiveRoot}/${UNASSIGNED_FOLDER}/${asset.assetKind}/${filename}`,
      modelName: archiveRoot,
    }
  }

  return {
    storagePath: `${runFolder}/direct_assets/${asset.assetKind}/${filename}`,
    modelName: 'direct_assets',
  }
}
