import type { Photo } from '../../state/store.js';

/**
 * A bundled demo case: a real smile and retracted pair, shipped with the app.
 *
 * The files are deliberately not in the repository. Demo imagery for a dental
 * tool is a licensing question before a technical one, and it is one only the
 * clinic can answer: a photograph's copyright comes from the photographer, but
 * an identifiable face carries the depicted person's own rights, and in a
 * clinical context implies their health data. So the application provides the
 * slot and whoever deploys it provides photographs they hold the rights to,
 * with a model release.
 *
 * Drop the two files in `public/demo/` and the button appears by itself:
 *
 *   public/demo/smile.jpg      -- frontal, natural smile, relaxed lips
 *   public/demo/retracted.jpg  -- same patient, cheek retractors in place
 *
 * Either name may use .jpg or .png. With neither present the button stays
 * hidden and the application behaves exactly as it does today.
 */

const CANDIDATES = {
  smile: ['/demo/smile.jpg', '/demo/smile.jpeg', '/demo/smile.png'],
  retracted: ['/demo/retracted.jpg', '/demo/retracted.jpeg', '/demo/retracted.png'],
} as const;

export interface DemoCase {
  smile: Photo;
  retracted: Photo;
}

/**
 * Whether a demo case is available to load.
 *
 * Checked rather than assumed, so a deployment without the files simply does
 * not offer the button -- better than offering one that fails.
 */
export async function demoCaseAvailable(): Promise<boolean> {
  const [smile, retracted] = await Promise.all([
    findFirst(CANDIDATES.smile),
    findFirst(CANDIDATES.retracted),
  ]);
  return smile !== null && retracted !== null;
}

/** Load both photos. Throws if either is missing or will not decode. */
export async function buildDemoCase(): Promise<DemoCase> {
  const [smileUrl, retractedUrl] = await Promise.all([
    findFirst(CANDIDATES.smile),
    findFirst(CANDIDATES.retracted),
  ]);
  if (!smileUrl || !retractedUrl) {
    throw new Error('The demo photos are not installed');
  }

  const [smile, retracted] = await Promise.all([
    load(smileUrl),
    load(retractedUrl),
  ]);
  return { smile, retracted };
}

/** The first candidate path that exists, or null. */
async function findFirst(paths: readonly string[]): Promise<string | null> {
  for (const path of paths) {
    try {
      const response = await fetch(path, { method: 'HEAD' });
      // A single-page app serves index.html for unknown paths, so a 200 alone
      // proves nothing -- the content type is what distinguishes a real image.
      const type = response.headers.get('content-type') ?? '';
      if (response.ok && type.startsWith('image/')) return path;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/**
 * Fetch a bundled photo into the same shape an upload produces.
 *
 * Copied to an object URL rather than used in place, so it behaves exactly
 * like an uploaded photo everywhere downstream -- including rotation, which
 * rewrites the blob, and persistence, which stores it.
 */
async function load(path: string): Promise<Photo> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not read ${path}`);

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  const { width, height } = await measure(url);
  return { url, width, height };
}

function measure(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('Could not decode the demo photo'));
    image.src = url;
  });
}
