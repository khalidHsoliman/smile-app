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
          /*
           * Only the one WASM build we actually load.
           *
           * MediaPipe ships three pairs and derives the filename at runtime:
           * `vision_wasm{_module}{_nosimd}_internal`. `_nosimd` is chosen only
           * when the browser lacks WASM SIMD, which no major browser has since
           * 2021; `_module` comes from `forVisionTasks`'s second parameter,
           * which defaults to false and we never pass. So the plain SIMD build
           * is the only one ever requested -- shipping the other two is 23 MB
           * of dead weight on every deploy.
           *
           * If this ever 404s at runtime, check that derivation first.
           */
          src: 'node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.*',
          dest: 'wasm',
          // Without this the source path is reproduced under dest, giving
          // dist/wasm/node_modules/@mediapipe/... instead of flat files.
          rename: { stripBase: true },
        },
      ],
    }),
  ],
});
