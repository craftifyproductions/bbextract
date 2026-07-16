import 'dotenv/config'
import express from 'express'
import session from 'express-session'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isProduction, PORT, SESSION_SECRET, validateConfig } from './config.js'
import {
  loginHandler,
  logoutHandler,
  requireAuth,
  requireStorageAuth,
  sessionHandler,
} from './auth.js'
import {
  downloadLogHandler,
  getLogContentHandler,
  listLogsHandler,
  saveLogHandler,
  syncManifestFromDisk,
} from './logs.js'
import { downloadR2FileHandler, healthR2Handler, uploadR2FileHandler } from './r2.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const distPath = resolve(__dirname, '../dist')

validateConfig()

const app = express()

app.disable('x-powered-by')
if (isProduction) {
  app.set('trust proxy', 1)
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'blob:', 'data:'],
        connectSrc: ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co'],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
)

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
})

app.use(
  cors({
    origin: isProduction ? false : ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  }),
)
app.use(express.json({ limit: '10mb' }))
app.use(cookieParser())
app.use(
  session({
    secret: SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
)

app.use('/api', apiLimiter)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.post('/api/auth/login', authLimiter, loginHandler)
app.post('/api/auth/logout', logoutHandler)
app.get('/api/auth/session', sessionHandler)

app.get('/api/r2/health', requireStorageAuth, healthR2Handler)
app.put('/api/r2/file', requireStorageAuth, uploadR2FileHandler)
app.get('/api/r2/file', requireStorageAuth, downloadR2FileHandler)

app.get('/api/logs', requireAuth, listLogsHandler)
app.post('/api/logs', requireAuth, saveLogHandler)
app.get('/api/logs/:id', requireAuth, getLogContentHandler)
app.get('/api/logs/:id/download', requireAuth, downloadLogHandler)

if (isProduction) {
  app.use(express.static(distPath))
  app.get('*', (_req, res) => {
    res.sendFile(resolve(distPath, 'index.html'))
  })
}

await syncManifestFromDisk()

app.listen(PORT, () => {
  console.log(`[BBExtract] Server running on http://localhost:${PORT}`)
})
