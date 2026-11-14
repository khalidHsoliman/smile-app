/**
 * Lets plain Node run the TypeScript sources for tests -- no packages needed.
 *
 * Node (22.18+) strips TypeScript types itself, but the sources import
 * `./teeth.js` for a file that is really `teeth.ts` (the Vite/TypeScript
 * convention). This hook retries such a relative `.js` import as `.ts` when
 * the `.js` file does not exist. Used via `node --import ./test/ts-resolve.mjs`.
 */
import { register } from 'node:module';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(
    `Tests need Node 22.18 or newer (built-in TypeScript type stripping); this is ${process.version}.`,
  );
  process.exit(1);
}

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        try {
          return await next(specifier, context);
        } catch (error) {
          const relative = specifier.startsWith('./') || specifier.startsWith('../');
          if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !relative || !specifier.endsWith('.js')) {
            throw error;
          }
          return next(specifier.slice(0, -3) + '.ts', context);
        }
      }
    `),
);
