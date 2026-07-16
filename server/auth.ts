import { timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'
import { PASSWORD, SUPABASE_ANON_KEY, SUPABASE_URL } from './config.js'

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.authenticated) {
    next()
    return
  }
  res.status(401).json({ error: 'Authentication required' })
}

let supabaseAuthClient: ReturnType<typeof createClient> | null = null

function getSupabaseAuthClient(): ReturnType<typeof createClient> | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
  if (!supabaseAuthClient) {
    supabaseAuthClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return supabaseAuthClient
}

function getBearerToken(req: Request): string | null {
  const header = req.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token || null
}

export async function requireStorageAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.session?.authenticated) {
    next()
    return
  }

  const token = getBearerToken(req)
  const supabase = getSupabaseAuthClient()
  if (!token || !supabase) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  next()
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export function loginHandler(req: Request, res: Response): void {
  const password = typeof req.body?.password === 'string' ? req.body.password : ''

  if (!password || !PASSWORD || !safeCompare(password, PASSWORD)) {
    res.status(401).json({ error: 'Invalid password' })
    return
  }

  req.session.authenticated = true
  res.json({ ok: true })
}

export function logoutHandler(req: Request, res: Response): void {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: 'Failed to logout' })
      return
    }
    res.clearCookie('connect.sid')
    res.json({ ok: true })
  })
}

export function sessionHandler(req: Request, res: Response): void {
  res.json({ authenticated: Boolean(req.session?.authenticated) })
}
