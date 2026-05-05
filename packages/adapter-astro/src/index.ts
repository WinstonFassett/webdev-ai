import type { AstroIntegration } from 'astro'
import { fileURLToPath } from 'node:url'
import { webdev, type ViteAdapterOptions } from '@winstonfassett/webdev-vite'
import { makeServerId } from '@winstonfassett/webdev-gateway/helpers'

export type AstroAdapterOptions = Omit<ViteAdapterOptions, 'serverType'>

export default function webdevAstro(options: AstroAdapterOptions = {}): AstroIntegration {
  const gatewayUrl = options.gateway ?? 'http://localhost:3333'
  return {
    name: '@winstonfassett/webdev-astro',
    hooks: {
      'astro:config:setup': ({ command, config, updateConfig, injectScript }) => {
        if (command !== 'dev') return

        updateConfig({
          vite: {
            plugins: [webdev({ ...options, serverType: 'astro' }) as any],
          },
        })

        // Astro's SSR renderer does not run Vite's transformIndexHtml on the final
        // page output, so the Vite plugin's HTML injection doesn't fire. Use Astro's
        // injectScript API instead to attach the same client init + meta tag.
        // Match the Vite plugin's serverId computation exactly: it uses Vite's
        // resolved config.root which has no trailing slash. fileURLToPath preserves
        // the trailing slash that Astro includes, so strip it.
        const rootPath = fileURLToPath(config.root).replace(/[/\\]$/, '')
        const serverId = makeServerId(rootPath, 'astro', options.key)

        const originJson = JSON.stringify(gatewayUrl)
        const serverIdJson = JSON.stringify(serverId)
        const inline =
          `window.__WEBDEV_ORIGIN__=${originJson};` +
          `window.__WEBDEV_SERVER__=${serverIdJson};` +
          `(function(){var m=document.createElement('meta');m.name='webdev';m.content=${originJson};` +
          `m.setAttribute('data-server-id',${serverIdJson});document.head.appendChild(m);})();` +
          `(function(){var s=document.createElement('script');s.src='/__webdev.js';document.head.appendChild(s);})();`

        injectScript('head-inline', inline)
      },
    },
  }
}
