import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// P5.6 감사: JS 총량 320KiB 차단 예산 — 스프라이트 manifest.json의 런타임 계약
// 필드(animation/frame_layout)만 번들에 인라인하고 provenance 필드(chroma_key·
// 리포트 경로 등)는 소스 파일에만 남긴다. 원본 manifest는 불가침(SSoT).
const spriteManifestRuntimeTrim = (): Plugin => ({
  name: 'sprite-manifest-runtime-trim',
  enforce: 'pre',
  transform(code, id) {
    if (!/assets\/generated\/sprites\/[^/]+\/manifest\.json$/.test(id)) return null;
    const manifest = JSON.parse(code) as Record<string, unknown>;
    const runtime: Record<string, unknown> = {};
    for (const key of ['characterId', 'animation', 'frame_layout'])
      if (key in manifest) runtime[key] = manifest[key];
    return { code: JSON.stringify(runtime), map: null };
  }
});

export default defineConfig(({ command }) => ({
  base: '/deckbuilding-roguelite/',
  define: { __VITE_PRODUCTION_BUILD__: JSON.stringify(command === 'build') },
  plugins: [spriteManifestRuntimeTrim(), react()],
  build: {
    target: 'es2022'
  },
  esbuild: { legalComments: 'none', drop: ['debugger'] },
  json: { stringify: true },
  resolve: {
    alias: {
      '@game/core': new URL('../../packages/core/src/index.ts', import.meta.url).pathname,
      '@game/content': new URL('../../packages/content/src/index.ts', import.meta.url).pathname
    }
  }
}));
