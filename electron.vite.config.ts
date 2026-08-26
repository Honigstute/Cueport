import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const productionConnectSource = "connect-src 'self'"

export default defineConfig(({ command }) => ({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [
      react(),
      ...(command === 'serve'
        ? [
            {
              name: 'cueport-development-csp',
              transformIndexHtml(html: string): string {
                // Vite's local WebSocket is required for HMR, but must never ship in packaged HTML.
                return html.replace(
                  productionConnectSource,
                  `${productionConnectSource} ws://localhost:*`
                )
              }
            }
          ]
        : [])
    ]
  }
}))
