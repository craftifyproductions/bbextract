import { useEffect } from 'react'

export interface ToastMessage {
  id: string
  message: string
  type: 'error' | 'success' | 'info'
}

interface ToastProps {
  toasts: ToastMessage[]
  onDismiss: (id: string) => void
}

const typeStyles = {
  error: 'border-red-500/40 bg-surface-elevated text-red-300',
  success: 'border-accent/40 bg-surface-elevated text-accent',
  info: 'border-border bg-surface-elevated text-text-primary',
}

export function Toast({ toasts, onDismiss }: ToastProps) {
  useEffect(() => {
    if (toasts.length === 0) return

    const timers = toasts.map((toast) =>
      window.setTimeout(() => onDismiss(toast.id), 5000),
    )

    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [toasts, onDismiss])

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed right-6 top-6 z-50 flex w-full max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`animate-slide-in pointer-events-auto rounded border px-4 py-3 text-sm ${typeStyles[toast.type]}`}
          role="alert"
        >
          <div className="flex items-start justify-between gap-3">
            <p>{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="text-xs text-text-secondary transition hover:text-text-primary"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
