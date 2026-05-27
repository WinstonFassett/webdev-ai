import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { DevTools } from '@vitejs/devtools'
import { webdev } from '@winstonfassett/webdev-vite'

export default defineConfig({
  plugins: [
    react(),
    DevTools(),
    webdev(),
  ],
})
