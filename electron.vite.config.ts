import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// В режиме разработки Vite добавляет inline-скрипт (React Refresh) и HMR по WebSocket,
// поэтому CSP из index.html ослабляется ТОЛЬКО для dev-сервера. В сборке остаётся строгая.
const devCsp: Plugin = {
  name: 'flow-dev-csp',
  apply: 'serve',
  transformIndexHtml(html, ctx) {
    // У окна-детектора своя CSP (wasm, воркеры): её dev-сервер не трогает.
    if (ctx.filename.endsWith('detector.html')) return html
    return html.replace(
      /<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/,
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: flow-media:; font-src 'self'; connect-src 'self' ws://localhost:* http://localhost:*" />`
    )
  }
}

export default defineConfig({
  main: {},
  // Второе окно (детектор игроков) — свой вход и свой preload.
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          detector: resolve('src/preload/detector.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          detector: resolve('src/renderer/detector.html')
        }
      }
    },
    plugins: [react(), devCsp]
  }
})
