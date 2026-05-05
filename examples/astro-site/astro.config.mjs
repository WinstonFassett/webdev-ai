// @ts-check
import { defineConfig } from 'astro/config';
import webdev from '@winstonfassett/webdev-astro';

// https://astro.build/config
export default defineConfig({
  integrations: [webdev()],
});
