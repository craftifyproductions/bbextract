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
import {
  deleteR2FileHandler,
  deleteR2PrefixHandler,
  downloadR2FileHandler,
  healthR2Handler,
  listR2Handler,
  uploadR2FileHandler,
} from './r2.js'
import { generate2DHandler, generate2DStatusHandler } from './generate2d.js'
import {
  ragBatchCancelHandler,
  ragBatchStartHandler,
  ragBatchStatusHandler,
  ragBatchSyncLimitsHandler,
} from './ragBatch.js'
import { ragLabelUploadHandler, ragVectorUploadHandler } from './ragLabelUpload.js'

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
  limit: 600,
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

// Local RAG label upload needs raw bytes — register before the JSON body parser.
app.post(
  '/api/rag/label-upload',
  requireStorageAuth,
  express.raw({ type: () => true, limit: '80mb' }),
  ragLabelUploadHandler,
)

// Larger JSON limit so local vector uploads can include base64 textures.
app.use(express.json({ limit: '40mb' }))

// R2 routes require auth and are used for bulk uploads — skip IP rate limits there.
// RAG/generate status polls are lightweight and poll often — skip so the UI doesn't 429.
app.use('/api', (req, res, next) => {
  if (
    req.path.startsWith('/r2') ||
    req.path === '/rag/batch/status' ||
    req.path === '/generate/2d/status' ||
    req.path === '/health'
  ) {
    next()
    return
  }
  apiLimiter(req, res, next)
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.post('/api/auth/login', authLimiter, loginHandler)
app.post('/api/auth/logout', logoutHandler)
app.get('/api/auth/session', sessionHandler)

app.get('/api/r2/health', requireStorageAuth, healthR2Handler)
app.get('/api/r2/list', requireStorageAuth, listR2Handler)
app.put('/api/r2/file', requireStorageAuth, uploadR2FileHandler)
app.get('/api/r2/file', requireStorageAuth, downloadR2FileHandler)
app.delete('/api/r2/file', requireStorageAuth, deleteR2FileHandler)
app.delete('/api/r2/prefix', requireStorageAuth, deleteR2PrefixHandler)

app.get('/api/logs', requireAuth, listLogsHandler)
app.post('/api/logs', requireAuth, saveLogHandler)
app.get('/api/logs/:id', requireAuth, getLogContentHandler)
app.get('/api/logs/:id/download', requireAuth, downloadLogHandler)

app.get('/api/generate/2d/status', generate2DStatusHandler)
app.post('/api/generate/2d', generate2DHandler)

app.get('/api/rag/batch/status', requireStorageAuth, ragBatchStatusHandler)
app.post('/api/rag/batch/start', requireStorageAuth, ragBatchStartHandler)
app.post('/api/rag/batch/cancel', requireStorageAuth, ragBatchCancelHandler)
app.post('/api/rag/batch/sync-limits', requireStorageAuth, ragBatchSyncLimitsHandler)
app.post('/api/rag/vector-upload', requireStorageAuth, ragVectorUploadHandler)

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
