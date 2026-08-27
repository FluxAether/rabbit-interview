import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const landingRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],
  root: landingRoot,
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
  },
  preview: {
    port: 4174,
    strictPort: true,
    host: true,
  },
})
