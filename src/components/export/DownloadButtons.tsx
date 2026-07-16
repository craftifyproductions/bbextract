import { useState } from 'react'
import { saveAs } from 'file-saver'
import { recordAuditEvent } from '../../lib/auditLogStore'
import { buildAllModelsZip, buildModelZip } from '../../lib/buildZip'
import type { ProcessedModel } from '../../lib/types'
import { Button } from '../ui/Button'

interface DownloadModelButtonProps {
  model: ProcessedModel
  size?: 'sm' | 'md'
}

export function DownloadModelButton({ model, size = 'md' }: DownloadModelButtonProps) {
  const [loading, setLoading] = useState(false)

  const handleDownload = async () => {
    if (model.status !== 'done') return
    setLoading(true)
    try {
      const blob = await buildModelZip(model)
      saveAs(blob, `${model.folderName}.zip`)
      void recordAuditEvent('downloaded_model_zip', `${model.folderName}.zip`, {
        modelName: model.metadata.name,
        originalFilename: model.originalFilename,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant="secondary"
      size={size}
      onClick={handleDownload}
      disabled={loading || model.status !== 'done'}
    >
      {loading ? 'Building…' : 'Download ZIP'}
    </Button>
  )
}

interface DownloadAllButtonProps {
  models: ProcessedModel[]
}

export function DownloadAllButton({ models }: DownloadAllButtonProps) {
  const [loading, setLoading] = useState(false)
  const doneModels = models.filter((model) => model.status === 'done')

  const handleDownload = async () => {
    if (doneModels.length === 0) return
    setLoading(true)
    try {
      const blob = await buildAllModelsZip(doneModels)
      saveAs(blob, 'bbextract_all_models.zip')
      void recordAuditEvent('downloaded_all_models_zip', 'bbextract_all_models.zip', {
        modelCount: doneModels.length,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="primary" onClick={handleDownload} disabled={loading || doneModels.length === 0}>
      {loading ? 'Building…' : 'Download All'}
    </Button>
  )
}
