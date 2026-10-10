import { createHash } from 'node:crypto'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Generuje sw.js: wszystko, co zbudowane, ląduje w cache przy pierwszej instalacji,
// potem aplikacja startuje bez sieci. Nowa wersja = nowy hash = czyszczenie starego cache.
function offlineWorker(): Plugin {
  return {
    name: 'fiszki-offline-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((name) => name !== 'sw.js')
      const extra = ['manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png']
      const urls = ['./', ...files, ...extra.filter((name) => !files.includes(name))]
      const hash = createHash('sha1')
      for (const name of files) {
        const item = bundle[name]
        hash.update(name).update(item.type === 'chunk' ? item.code : (item.source as string | Uint8Array))
      }
      const version = hash.digest('hex').slice(0, 10)
      const source = `const CACHE = 'fiszki-${version}'
const URLS = ${JSON.stringify(urls)}
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(URLS)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})
self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit
      if (request.mode === 'navigate') return caches.match('./')
      return fetch(request)
    }),
  )
})
`
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), offlineWorker()],
  server: {
    port: 5173,
    open: true,
  },
  optimizeDeps: {
    exclude: ['sql.js'],
  },
  build: {
    target: 'safari14',
    cssTarget: 'safari14',
    chunkSizeWarningLimit: 600,
  },
})
