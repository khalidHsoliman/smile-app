import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

/**
 * The MediaPipe WASM runtime is served from our own origin, not a CDN: patient
 * photos never leave the browser, so the analysis step must not make a
 * third-party request (see `src/vision/faceLandmarker.ts`).
 *
 * The runtime is ~38 MB across its SIMD and no-SIMD variants, which does not
 * belong in git, so it is copied out of node_modules at build time instead of
 * being checked into `public/`. The model file *is* checked in -- at 3.7 MB it
 * is small enough, and it has no npm package to be copied from.
 */
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@mediapipe/tasks-vision/wasm/*',
          dest: 'wasm',
          // Without this the source path is reproduced under dest, giving
          // dist/wasm/node_modules/@mediapipe/... instead of flat files.
          rename: { stripBase: true },
        },
      ],
    }),
  ],
});
