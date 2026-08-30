import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(import.meta.dirname, 'client'),
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, 'dist-client'),
    emptyOutDir: true
  },
  server: {
    fs: { allow: [resolve(import.meta.dirname, '../..')] },
    proxy: { '/api': 'http://127.0.0.1:3002' }
  }
})
