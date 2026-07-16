import { useCallback, useEffect, useState } from 'react'
import { isSupabaseConfigured } from '../lib/envSettings'
import { getSupabaseClient } from '../lib/supabaseClient'

export function useAuth() {
  const [authenticated, setAuthenticated] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setAuthenticated(false)
      setUserEmail(null)
      setLoading(false)
      return false
    }

    try {
      const supabase = await getSupabaseClient()
      const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } }
      const isAuthed = Boolean(data.session)
      setAuthenticated(isAuthed)
      setUserEmail(data.session?.user.email ?? null)
      return isAuthed
    } catch {
      setAuthenticated(false)
      setUserEmail(null)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!isSupabaseConfigured()) return

    let unsubscribed = false
    let unsubscribe: (() => void) | undefined

    void getSupabaseClient().then((supabase) => {
      if (!supabase || unsubscribed) return
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        setAuthenticated(Boolean(session))
        setUserEmail(session?.user.email ?? null)
        setLoading(false)
      })
      unsubscribe = () => data.subscription.unsubscribe()
    })

    return () => {
      unsubscribed = true
      unsubscribe?.()
    }
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    setError(null)

    if (!isSupabaseConfigured()) {
      setError('Authentication is not configured. Check the project environment variables.')
      return false
    }

    try {
      const supabase = await getSupabaseClient()
      if (!supabase) throw new Error('Authentication client is unavailable')
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: username.trim(),
        password,
      })
      if (signInError) throw signInError
      setAuthenticated(true)
      setUserEmail(data.user?.email ?? username.trim())
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed'
      setError(message)
      setAuthenticated(false)
      setUserEmail(null)
      return false
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      const supabase = await getSupabaseClient()
      await supabase?.auth.signOut()
    } finally {
      setAuthenticated(false)
      setUserEmail(null)
    }
  }, [])

  return {
    authenticated,
    userEmail,
    loading,
    error,
    login,
    logout,
    refresh,
    clearError: () => setError(null),
  }
}
