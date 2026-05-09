import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { webdev } from '@winstonfassett/webdev-vite'

export default defineConfig(({ command }) => ({
  plugins: [svelte(), tailwindcss(), webdev()],
  base: command === 'build' ? '/__admin/' : '/',
  build: {
    outDir: '../../apps/gateway/dist/admin',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
  },
}))
