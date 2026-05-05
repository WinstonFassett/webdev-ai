/**
 * Storybook preset for webdev
 *
 * Usage in .storybook/main.ts:
 *   addons: ['@winstonfassett/webdev-vite/storybook']
 */

export interface StorybookPresetOptions {
  gateway?: string
}

export async function viteFinal(
  config: Record<string, any>,
  options: { presetOptions?: StorybookPresetOptions } = {},
) {
  const { webdev } = await import('../index.js')
  const gateway = options.presetOptions?.gateway
  config.plugins = config.plugins || []
  config.plugins.push(webdev({ gateway, serverType: 'storybook' }))
  return config
}
