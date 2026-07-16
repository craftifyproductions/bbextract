import { saveAs } from 'file-saver'
import { recordAuditEvent } from '../../lib/auditLogStore'
import type { AnimationsManifestEntry, ExtractedAnimation, ExtractedTexture } from '../../lib/types'
import { formatBytes } from '../../lib/stats'
import { Button } from '../ui/Button'
import { RawDataTab } from './RawDataTab'

export interface ModelElementAsset {
  id: string
  label: string
  kind: 'outliner' | 'element'
  data: Record<string, unknown>
  filename: string
}

export type SelectedAsset =
  | { type: 'texture'; texture: ExtractedTexture }
  | { type: 'animation'; animation: AnimationsManifestEntry | ExtractedAnimation }
  | { type: 'element'; element: ModelElementAsset }
  | null

interface AssetInspectorProps {
  selectedAsset: SelectedAsset
  modelMeta: {
    resolutionLabel: string
    formatLabel: string
    elements: number
    bones: number
    textures: number
    animations: number
    keyframes: number
    sizeLabel: string
    extractedAt: string
  }
  rawText?: string
  summary: Record<string, unknown>
}

export function AssetInspector({
  selectedAsset,
  modelMeta,
  rawText,
  summary,
}: AssetInspectorProps) {
  if (selectedAsset?.type === 'texture') {
    return <TextureInspector texture={selectedAsset.texture} />
  }

  if (selectedAsset?.type === 'animation') {
    return <AnimationInspector animation={selectedAsset.animation} />
  }

  if (selectedAsset?.type === 'element') {
    return <ElementInspector element={selectedAsset.element} />
  }

  return (
    <div>
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">
        Metadata
      </h3>
      <dl className="space-y-2 font-mono text-xs">
        <MetaRow label="Resolution" value={modelMeta.resolutionLabel} />
        <MetaRow label="Format" value={modelMeta.formatLabel} />
        <MetaRow label="Elements" value={String(modelMeta.elements)} />
        <MetaRow label="Bones" value={String(modelMeta.bones)} />
        <MetaRow label="Textures" value={String(modelMeta.textures)} />
        <MetaRow label="Animations" value={String(modelMeta.animations)} />
        <MetaRow label="Keyframes" value={String(modelMeta.keyframes)} />
        <MetaRow label="Size" value={modelMeta.sizeLabel} />
        <MetaRow label="Extracted" value={modelMeta.extractedAt} />
      </dl>

      <div className="mt-6">
        <RawDataTab rawText={rawText} summary={summary} />
      </div>
    </div>
  )
}

function TextureInspector({ texture }: { texture: ExtractedTexture }) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">
        Texture
      </h3>
      <div className="overflow-hidden rounded border border-border bg-surface-elevated">
        <div className="flex aspect-square items-center justify-center bg-checkerboard p-4">
          <img
            src={texture.previewUrl}
            alt={texture.name}
            className="max-h-full max-w-full object-contain"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>
        <div className="border-t border-border p-4">
          <p className="break-words text-sm text-text-primary">{texture.name}</p>
          <dl className="mt-3 space-y-2 font-mono text-xs">
            <MetaRow label="File" value={texture.filename} />
            <MetaRow label="Size" value={`${texture.width}×${texture.height}`} />
            <MetaRow label="Bytes" value={formatBytes(texture.blob.size)} />
            <MetaRow label="UUID" value={texture.uuid} />
          </dl>
          <Button
            variant="primary"
            className="mt-4 w-full"
            onClick={() => {
              saveAs(texture.blob, texture.filename)
              void recordAuditEvent('downloaded_texture', texture.filename, {
                textureName: texture.name,
                width: texture.width,
                height: texture.height,
              })
            }}
          >
            Download Texture
          </Button>
        </div>
      </div>
    </div>
  )
}

function AnimationInspector({
  animation,
}: {
  animation: AnimationsManifestEntry | ExtractedAnimation
}) {
  const hasData = 'data' in animation
  const content = hasData ? JSON.stringify(animation.data, null, 2) : ''
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const loopLabel =
    animation.loop === true || animation.loop === 'hold'
      ? 'Loop'
      : animation.loop
        ? String(animation.loop)
        : 'Once'

  return (
    <div>
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">
        Animation
      </h3>
      <div className="rounded border border-border bg-surface-elevated p-4">
        <p className="break-words text-sm text-text-primary">{animation.name}</p>
        <dl className="mt-3 space-y-2 font-mono text-xs">
          <MetaRow label="File" value={animation.filename} />
          <MetaRow label="Length" value={`${animation.length}s`} />
          <MetaRow label="Loop" value={loopLabel} />
          <MetaRow label="Keyframes" value={String(animation.keyframeCount)} />
        </dl>
        <Button
          variant="primary"
          className="mt-4 w-full"
          disabled={!hasData}
          onClick={() => {
            saveAs(blob, animation.filename)
            void recordAuditEvent('downloaded_animation', animation.filename, {
              animationName: animation.name,
              keyframes: animation.keyframeCount,
            })
          }}
        >
          {hasData ? 'Download Animation JSON' : 'Animation data unavailable'}
        </Button>
      </div>

      {hasData ? (
        <pre className="mt-4 max-h-96 overflow-auto rounded border border-border bg-surface-base p-3 font-mono text-xs leading-relaxed text-text-secondary whitespace-pre-wrap">
          {content}
        </pre>
      ) : null}
    </div>
  )
}

function ElementInspector({ element }: { element: ModelElementAsset }) {
  const content = JSON.stringify(element.data, null, 2)
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })

  return (
    <div>
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">
        {element.kind === 'element' ? 'Element' : 'Outliner Item'}
      </h3>
      <div className="rounded border border-border bg-surface-elevated p-4">
        <p className="break-words text-sm text-text-primary">{element.label}</p>
        <dl className="mt-3 space-y-2 font-mono text-xs">
          <MetaRow label="Type" value={element.kind} />
          <MetaRow label="File" value={element.filename} />
          <MetaRow label="ID" value={element.id} />
        </dl>
        <Button
          variant="primary"
          className="mt-4 w-full"
          onClick={() => {
            saveAs(blob, element.filename)
            void recordAuditEvent('downloaded_element_json', element.filename, {
              label: element.label,
              kind: element.kind,
            })
          }}
        >
          Download JSON
        </Button>
      </div>

      <pre className="mt-4 max-h-96 overflow-auto rounded border border-border bg-surface-base p-3 font-mono text-xs leading-relaxed text-text-secondary whitespace-pre-wrap">
        {content}
      </pre>
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/60 pb-2">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="break-words text-right text-text-primary">{value}</dd>
    </div>
  )
}
