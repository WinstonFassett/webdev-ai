// @ts-check
import { defineConfig } from 'astro/config';
import webDevMcp from '@winstonfassett/web-dev-mcp-astro';

// https://astro.build/config
export default defineConfig({
  integrations: [webDevMcp()],
});
