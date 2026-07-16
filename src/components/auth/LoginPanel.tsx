import { useState, type FormEvent } from 'react'
import { Button } from '../ui/Button'

interface LoginPanelProps {
  title?: string
  description?: string
  error?: string | null
  onSubmit: (username: string, password: string) => Promise<boolean>
  onClearError?: () => void
}

export function LoginPanel({
  title = 'Dashboard access',
  description = 'Enter the password to view the dashboard, model details, and session logs.',
  error,
  onSubmit,
  onClearError,
}: LoginPanelProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!username.trim() || !password.trim()) return

    setSubmitting(true)
    try {
      await onSubmit(username, password)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-lg rounded border border-border bg-surface-elevated p-5 sm:p-8">
        <div className="mb-5 sm:mb-6">
          <p className="font-mono text-xs uppercase tracking-wider text-accent">Authentication</p>
          <h1 className="mt-2 text-lg font-semibold text-text-primary sm:text-xl">{title}</h1>
          <p className="mt-2 text-sm text-text-secondary">{description}</p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label
              htmlFor="dashboard-username"
              className="mb-2 block font-mono text-xs uppercase tracking-wider text-text-secondary"
            >
              Username / Email
            </label>
            <input
              id="dashboard-username"
              type="email"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value)
                onClearError?.()
              }}
              autoComplete="username"
              autoFocus
              className="w-full rounded border border-border bg-surface-base px-3 py-3 font-mono text-base text-text-primary outline-none transition-colors focus:border-accent/60 focus:ring-1 focus:ring-accent/30"
              placeholder="name@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="dashboard-password"
              className="mb-2 block font-mono text-xs uppercase tracking-wider text-text-secondary"
            >
              Password
            </label>
            <input
              id="dashboard-password"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                onClearError?.()
              }}
              autoComplete="current-password"
              className="w-full rounded border border-border bg-surface-base px-3 py-3 font-mono text-base text-text-primary outline-none transition-colors focus:border-accent/60 focus:ring-1 focus:ring-accent/30"
              placeholder="Enter password"
            />
          </div>

          {error ? (
            <p className="font-mono text-xs text-red-400" role="alert">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            disabled={submitting || !username.trim() || !password.trim()}
            className="w-full"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  )
}
