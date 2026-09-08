import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const landingRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],
  root: landingRoot,
  envDir: fileURLToPath(new URL("../server", import.meta.url)),
  css: {
    postcss: landingRoot,
  },
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@landing': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 4174,
    strictPort: true,
    host: true,
    proxy: {
      '/oauth2': 'http://127.0.0.1:8787',
      '/account': 'http://127.0.0.1:8787',
      '/v1': 'http://127.0.0.1:8787',
      '/internal': 'http://127.0.0.1:8787',
      '/.well-known': 'http://127.0.0.1:8787',
    },
  },
  preview: {
    port: 4174,
    strictPort: true,
    host: true,
    proxy: {
      '/oauth2': 'http://127.0.0.1:8787',
      '/account': 'http://127.0.0.1:8787',
      '/v1': 'http://127.0.0.1:8787',
      '/internal': 'http://127.0.0.1:8787',
      '/.well-known': 'http://127.0.0.1:8787',
    },
  },
})
