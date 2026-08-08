/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // Generate 3D OpenRouter jobs can run several minutes (SSE progress stream).
        timeout: 10 * 60 * 1000,
        proxyTimeout: 10 * 60 * 1000,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            console.error('[vite] /api proxy error — is the API server on :3001?', err.message)
            const socket = res as { writeHead?: (code: number, headers: Record<string, string>) => void; end?: (body: string) => void }
            if (typeof socket.writeHead === 'function' && typeof socket.end === 'function') {
              socket.writeHead(502, { 'Content-Type': 'application/json' })
              socket.end(
                JSON.stringify({
                  error:
                    'API proxy failed — start the server (`npm run dev` / tsx on port 3001). ' +
                    err.message,
                }),
              )
            }
          })
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
