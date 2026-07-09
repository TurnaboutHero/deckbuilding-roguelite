import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/deckbuilding-roguelite/',
  plugins: [react()],
  resolve: {
    alias: {
      '@game/core': new URL('../../packages/core/src/index.ts', import.meta.url).pathname,
      '@game/content': new URL('../../packages/content/src/index.ts', import.meta.url).pathname
    }
  }
});
