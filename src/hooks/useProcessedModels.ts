import { useCallback, useEffect, useReducer, useRef, useState, startTransition } from 'react'
import { modelDataStore } from '../lib/modelDataStore'
import { revokeModelUrls } from '../lib/parseModel'
import type { ExtractedTexture, ProcessedModel } from '../lib/types'

export type CommitModelPatch = Partial<ProcessedModel> & {
  assetTextures?: ExtractedTexture[]
}

function toLightweightPatch(patch: CommitModelPatch): Partial<ProcessedModel> {
  const { assetTextures: _assetTextures, ...rest } = patch
  return { ...rest, rawText: undefined }
}

function storeHeavyModelData(id: string, patch: CommitModelPatch): void {
  const rawText = patch.rawText ?? modelDataStore.get(id)?.rawText ?? ''
  const assetTextures = patch.assetTextures ?? modelDataStore.get(id)?.textures ?? []

  if (!rawText && assetTextures.length === 0) return

  modelDataStore.set(id, {
    rawText,
    geometry: { elements: [], outliner: [] },
    animations: [],
    textures: assetTextures,
  })
}

type ModelsAction =
  | { type: 'add'; model: ProcessedModel }
  | { type: 'update'; id: string; patch: Partial<ProcessedModel> }
  | { type: 'batch_update'; updates: Array<{ id: string; patch: Partial<ProcessedModel> }> }
  | { type: 'remove'; id: string }
  | { type: 'clear' }

function modelsReducer(state: ProcessedModel[], action: ModelsAction): ProcessedModel[] {
  switch (action.type) {
    case 'add':
      return [action.model, ...state]
    case 'update':
      return state.map((model) =>
        model.id === action.id ? { ...model, ...action.patch } : model,
      )
    case 'batch_update': {
      const patchMap = new Map(action.updates.map((update) => [update.id, update.patch]))
      return state.map((model) =>
        patchMap.has(model.id) ? { ...model, ...patchMap.get(model.id)! } : model,
      )
    }
    case 'remove': {
      const target = state.find((model) => model.id === action.id)
      if (target) revokeModelUrls(target)
      modelDataStore.remove(action.id)
      return state.filter((model) => model.id !== action.id)
    }
    case 'clear': {
      for (const model of state) revokeModelUrls(model)
      modelDataStore.clear()
      return []
    }
    default:
      return state
  }
}

export function useProcessedModels() {
  const [models, dispatch] = useReducer(modelsReducer, [])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const addModel = useCallback((model: ProcessedModel) => {
    dispatch({ type: 'add', model })
  }, [])

  const updateModel = useCallback((id: string, patch: Partial<ProcessedModel>) => {
    dispatch({ type: 'update', id, patch })
  }, [])

  const commitModel = useCallback((id: string, patch: CommitModelPatch) => {
    storeHeavyModelData(id, patch)
    const lightweightPatch = toLightweightPatch(patch)
    startTransition(() => {
      dispatch({ type: 'update', id, patch: lightweightPatch })
    })
  }, [])

  const batchCommitModels = useCallback(
    (updates: Array<{ id: string; patch: Partial<ProcessedModel> }>) => {
      startTransition(() => {
        dispatch({ type: 'batch_update', updates })
      })
    },
    [],
  )

  const removeModel = useCallback((id: string) => {
    dispatch({ type: 'remove', id })
    setSelectedId((current) => (current === id ? null : current))
  }, [])

  const clearModels = useCallback(() => {
    dispatch({ type: 'clear' })
    setSelectedId(null)
  }, [])

  const modelsRef = useRef(models)
  modelsRef.current = models

  useEffect(() => {
    return () => {
      for (const model of modelsRef.current) revokeModelUrls(model)
      modelDataStore.clear()
    }
  }, [])

  const selectedModel = models.find((model) => model.id === selectedId) ?? null

  return {
    models,
    selectedModel,
    selectedId,
    setSelectedId,
    addModel,
    updateModel,
    commitModel,
    batchCommitModels,
    removeModel,
    clearModels,
  }
}
