import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In production the API (src/WdsWeb.Api) serves the built app from its wwwroot. In development this
// dev server serves it and proxies /api to the API on port 5080.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:5080' },
  },
  build: {
    outDir: '../src/WdsWeb.Api/wwwroot',
    emptyOutDir: true,
  },
})
