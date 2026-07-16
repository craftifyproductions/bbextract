import type { TreeNodeProps } from '../ui/TreeNode'
import { TreeNode, TreeRoot } from '../ui/TreeNode'
import type { ModelElementAsset } from './AssetInspector'

interface BonesTabProps {
  elements: unknown[]
  outliner: unknown[]
  selectedElementId?: string | null
  onSelectElement?: (asset: ModelElementAsset) => void
}

function buildLookupMaps(elements: unknown[]) {
  const byUuid = new Map<string, string>()
  const elementByUuid = new Map<string, Record<string, unknown>>()

  for (const element of elements) {
    if (!element || typeof element !== 'object') continue
    const obj = element as Record<string, unknown>
    const uuid = typeof obj.uuid === 'string' ? obj.uuid : null
    if (!uuid) continue
    const name =
      typeof obj.name === 'string' && obj.name.trim()
        ? obj.name
        : typeof obj.type === 'string'
          ? obj.type
          : uuid.slice(0, 8)
    byUuid.set(uuid, name)
    elementByUuid.set(uuid, obj)
  }

  return { byUuid, elementByUuid }
}

function makeAsset(
  id: string,
  label: string,
  kind: 'outliner' | 'element',
  data: Record<string, unknown>,
): ModelElementAsset {
  const safeLabel = label.replace(/[^\w.-]+/g, '_') || kind
  return {
    id,
    label,
    kind,
    data,
    filename: `${safeLabel}.json`,
  }
}

function buildTreeNodes(
  nodes: unknown[],
  lookup: Map<string, string>,
  elementByUuid: Map<string, Record<string, unknown>>,
  onSelectElement?: (asset: ModelElementAsset) => void,
): TreeNodeProps[] {
  const result: TreeNodeProps[] = []

  for (const node of nodes) {
    if (typeof node === 'string') {
      const label = lookup.get(node) ?? node.slice(0, 8)
      const element = elementByUuid.get(node)
      result.push({
        id: node,
        label,
        subtitle: lookup.has(node) ? 'element' : 'ref',
        onSelect: element
          ? () => onSelectElement?.(makeAsset(node, label, 'element', element))
          : undefined,
      })
      continue
    }

    if (!node || typeof node !== 'object') continue
    const obj = node as Record<string, unknown>
    const name =
      typeof obj.name === 'string' && obj.name.trim()
        ? obj.name
        : typeof obj.uuid === 'string'
          ? obj.uuid.slice(0, 8)
          : 'bone'
    const children = Array.isArray(obj.children)
      ? buildTreeNodes(obj.children, lookup, elementByUuid, onSelectElement)
      : undefined
    const uuid = typeof obj.uuid === 'string' ? obj.uuid : `outliner-${result.length}-${name}`

    result.push({
      id: uuid,
      label: name,
      subtitle: typeof obj.uuid === 'string' ? obj.uuid.slice(0, 8) : undefined,
      children,
      onSelect: () => onSelectElement?.(makeAsset(uuid, name, 'outliner', obj)),
    })
  }

  return result
}

export function BonesTab({
  elements,
  outliner,
  selectedElementId,
  onSelectElement,
}: BonesTabProps) {
  if (outliner.length === 0 && elements.length === 0) {
    return <p className="text-xs text-text-secondary">No outliner / elements in this model.</p>
  }

  const { byUuid, elementByUuid } = buildLookupMaps(elements)
  const tree =
    outliner.length > 0
      ? buildTreeNodes(outliner, byUuid, elementByUuid, onSelectElement)
      : elements
          .filter((element): element is Record<string, unknown> => Boolean(element && typeof element === 'object'))
          .map((element, index) => {
            const uuid = typeof element.uuid === 'string' ? element.uuid : `element-${index}`
            const label =
              typeof element.name === 'string' && element.name.trim()
                ? element.name
                : typeof element.type === 'string'
                  ? element.type
                  : uuid
            return {
              id: uuid,
              label,
              subtitle: 'element',
              onSelect: () => onSelectElement?.(makeAsset(uuid, label, 'element', element)),
            }
          })

  return (
    <TreeRoot>
      {tree.map((node, index) => (
        <TreeNode
          key={`${node.label}-${index}`}
          {...node}
          selectedId={selectedElementId}
          onSelect={node.onSelect}
        />
      ))}
    </TreeRoot>
  )
}
