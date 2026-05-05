import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [
    '@storybook/addon-essentials',
    '@winstonfassett/webdev-vite/storybook',
  ],
  framework: '@storybook/react-vite',
}

export default config
