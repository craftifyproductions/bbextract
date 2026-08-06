import { useCallback, useRef, useState } from 'react'
import { LoginPanel } from './components/auth/LoginPanel'
import { AppShell } from './components/layout/AppShell'
import { ProcessingBanner } from './components/layout/ProcessingBanner'
import type { AppView } from './components/layout/Sidebar'
import { Footer } from './components/layout/Footer'
import { DropZone } from './components/upload/DropZone'
import { EmptyState } from './components/dashboard/EmptyState'
import { DashboardView } from './components/dashboard/DashboardView'
import { ModelDetailPanel } from './components/detail/ModelDetailPanel'
import { FileManagerView } from './components/files/FileManagerView'
import { GenerateView } from './components/generate/GenerateView'
import { RagWorkspace } from './components/rag/RagWorkspace'
import { Toast, type ToastMessage } from './components/ui/Toast'
import { useAuth } from './hooks/useAuth'
import { useConsole } from './hooks/useConsole'
import { useProcessedModels } from './hooks/useProcessedModels'
import { useFileProcessor } from './hooks/useFileProcessor'
import { useProcessingProgress } from './hooks/useProcessingProgress'
import type { UploadItem } from './lib/types'

function App() {
  const {
    models,
    selectedModel,
    setSelectedId,
    addModel,
    commitModel,
    clearModels,
  } = useProcessedModels()

  const {
    queueInfo,
    uploadInfo,
    isProcessing,
    isUploading,
    activeProcessingId,
    getProgress,
    setProgress,
    clearProgress,
    setQueuePosition,
    clearQueue,
    setUploadProgress,
    clearUploadProgress,
    setActiveProcessingId,
  } = useProcessingProgress()

  const { authenticated, userEmail, loading: authLoading, error: authError, login, logout, clearError } =
    useAuth()

  const { lines: consoleLines, api: consoleApi, clear: clearConsole, getText: getConsoleText } =
    useConsole()

  const [activeView, setActiveView] = useState<AppView>('upload')
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const logsRefreshRef = useRef<(() => void) | null>(null)

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const showToast = useCallback(
    (message: string, type: ToastMessage['type'] = 'error') => {
      setToasts((prev) => [...prev, { id: crypto.randomUUID(), message, type }])
    },
    [],
  )

  const handleProcessingError = useCallback(
    (error: { message: string; severity?: 'error' | 'warning' | 'info' }) => {
      const type =
        error.severity === 'warning'
          ? 'warning'
          : error.severity === 'info'
            ? 'info'
            : 'error'
      showToast(error.message, type)
    },
    [showToast],
  )

  const {
    processFiles,
    prepareUpload,
    beginUploadSession,
    cancelUpload,
    isUploadActive,
    isUploadCancelled,
  } = useFileProcessor(
    addModel,
    commitModel,
    handleProcessingError,
    {
      setProgress,
      clearProgress,
      setQueuePosition,
      clearQueue,
      setUploadProgress,
      clearUploadProgress,
      setActiveProcessingId,
    },
    consoleApi,
    authenticated,
    userEmail,
    () => {
      logsRefreshRef.current?.()
    },
  )

  const handleLogin = useCallback(
    async (username: string, password: string) => {
      const ok = await login(username, password)
      if (ok) {
        logsRefreshRef.current?.()
      }
      return ok
    },
    [login],
  )

  const navigateTo = useCallback(
    (view: AppView) => {
      setSelectedId(null)
      setActiveView(view)
    },
    [setSelectedId],
  )

  const handleCopyConsole = useCallback(async () => {
    const text = getConsoleText()
    if (!text) return

    try {
      await navigator.clipboard.writeText(text)
      showToast('Console copied to clipboard', 'success')
    } catch {
      showToast('Failed to copy console output', 'error')
    }
  }, [getConsoleText, showToast])

  const handleFiles = useCallback(
    (items: UploadItem[]) => {
      void processFiles(items)
      if (items.length > 0) {
        setActiveView('dashboard')
      }
    },
    [processFiles],
  )

  const handleUploadReject = useCallback(
    (message: string) => {
      if (message === 'Upload cancelled') {
        showToast('Upload cancelled', 'success')
        return
      }
      showToast(message, 'error')
    },
    [showToast],
  )

  const handleCancelUpload = useCallback(() => {
    cancelUpload()
    showToast('Upload cancelled', 'success')
  }, [cancelUpload, showToast])

  const dropZoneProps = {
    onFiles: handleFiles,
    onPrepareUpload: prepareUpload,
    onBeginUploadSession: beginUploadSession,
    onCancelUpload: isUploadActive ? handleCancelUpload : undefined,
    isUploadCancelled,
    onReject: handleUploadReject,
  }

  const handleCloseDetail = useCallback(() => {
    setSelectedId(null)
  }, [setSelectedId])

  const hasModels = models.length > 0
  const doneCount = models.filter((m) => m.status === 'done').length
  const showingDetail = Boolean(selectedModel && selectedModel.status === 'done')
  const activeProcessingModel = activeProcessingId
    ? models.find((model) => model.id === activeProcessingId)
    : undefined

  const renderProtectedContent = () => {
    if (showingDetail && selectedModel) {
      return <ModelDetailPanel model={selectedModel} onClose={handleCloseDetail} />
    }

    return (
      <DashboardView
        models={models}
        authenticated={authenticated}
        hasModels={hasModels}
        doneCount={doneCount}
        onClear={clearModels}
        onViewDetails={setSelectedId}
        getProgress={getProgress}
        queueInfo={queueInfo}
        activeProcessingId={activeProcessingId}
        onLogRefresh={(refresh) => {
          logsRefreshRef.current = refresh
        }}
        consoleLines={consoleLines}
        onClearConsole={clearConsole}
        onCopyConsole={() => void handleCopyConsole()}
      />
    )
  }

  const renderContent = () => {
    if (showingDetail) {
      return renderProtectedContent()
    }

    if (activeView === 'upload') {
      return (
        <div className="flex min-h-[calc(100vh-9rem)] flex-col">
          <div className="mb-6 text-center sm:mb-8">
            <h1 className="mb-1 text-2xl font-semibold text-text-primary max-sm:text-xl">Upload</h1>
            <p className="mx-auto max-w-xl text-base text-text-secondary max-sm:text-sm">
              Drop Blockbench .bbmodel files to extract locally. Model details require a password.
            </p>
          </div>
          {!hasModels ? (
            <EmptyState centered>
              <DropZone {...dropZoneProps} />
            </EmptyState>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <DropZone {...dropZoneProps} compact />
            </div>
          )}
        </div>
      )
    }

    if (activeView === 'dashboard') {
      return renderProtectedContent()
    }

    if (activeView === 'generate') {
      return <GenerateView />
    }

    if (activeView === 'rag') {
      return <RagWorkspace />
    }

    if (activeView === 'files') {
      return <FileManagerView />
    }

    return null
  }

  return (
    <>
      {authLoading ? (
        <div className="flex min-h-screen flex-col bg-surface-base">
          <main className="flex flex-1 items-center justify-center px-6">
            <p className="font-mono text-sm text-text-secondary">Checking session…</p>
          </main>
          <Footer />
        </div>
      ) : !authenticated ? (
        <div className="flex min-h-screen flex-col bg-surface-base">
          <main className="flex-1 px-4 py-6 sm:px-6 sm:py-10">
            <LoginPanel
              error={authError}
              onSubmit={handleLogin}
              onClearError={clearError}
              title="BBExtract access"
              description="Sign in to upload models, view the dashboard, and read logs."
            />
          </main>
          <Footer />
        </div>
      ) : (
        <AppShell
          activeView={showingDetail ? 'dashboard' : activeView}
          onNavigate={navigateTo}
          modelCount={doneCount}
          authenticated={authenticated}
          onLogout={() => void logout()}
          banner={
            isUploadActive ||
            (isProcessing && queueInfo && queueInfo.total > 0) ||
            (isUploading && uploadInfo && uploadInfo.total > 0) ? (
              <ProcessingBanner
                queueInfo={queueInfo}
                uploadInfo={uploadInfo}
                activeProcessingId={activeProcessingId}
                getProgress={getProgress}
                currentFilename={activeProcessingModel?.originalFilename}
                onCancel={
                  isUploadActive || isProcessing || isUploading ? handleCancelUpload : undefined
                }
              />
            ) : null
          }
        >
          {renderContent()}
        </AppShell>
      )}

      <Toast toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}

export default App
