import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Brak elementu root.')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('storage' in navigator && navigator.storage.persist) void navigator.storage.persist().catch(() => undefined)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => undefined)
  })
}
