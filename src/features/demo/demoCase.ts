import type { Photo } from '../../state/store.js';
import { drawFace } from './drawFace.js';

/**
 * A ready-made case for demonstrating the tool.
 *
 * Drawn rather than photographed, and that is a legal decision more than an
 * aesthetic one. A photograph's licence comes from the photographer, but an
 * identifiable face carries the depicted person's own rights, and in a dental
 * context implies their health data. A CC0 stock photo is copyright-clean and
 * still not safe to ship in a demo that presents the person as a patient.
 * Nobody is depicted here, so the question does not arise.
 *
 * The two views are generated from one face at a different distance and pitch,
 * so the alignment step has real work to do -- a demo whose photos happened to
 * line up would demonstrate nothing about the hardest part of the application.
 */

/**
 * Rendered at a realistic clinical resolution.
 *
 * Not a token size: the snapshot pipeline captures at native resolution and the
 * enamel sampler reads real pixels, so a small demo image would exercise
 * neither. This is about what a phone camera produces after cropping to
 * portrait.
 */
const WIDTH = 1200;
const HEIGHT = 1600;

/**
 * How the retracted view differs from the smile view.
 *
 * Shot closer, and with the chin dropped a little -- which is what actually
 * happens when retractors go in, and what leaves the mouth displaced relative
 * to the eyes after a face-landmark fit.
 */
const RETRACTED_ZOOM = 1.12;
const RETRACTED_PITCH = 34;

export interface DemoCase {
  smile: Photo;
  retracted: Photo;
}

/** Build both views and return them as ordinary photos. */
export async function buildDemoCase(): Promise<DemoCase> {
  const [smile, retracted] = await Promise.all([
    render({ retracted: false, pitchShift: 0, zoom: 1 }),
    render({ retracted: true, pitchShift: RETRACTED_PITCH, zoom: RETRACTED_ZOOM }),
  ]);
  return { smile, retracted };
}

async function render(options: {
  retracted: boolean;
  pitchShift: number;
  zoom: number;
}): Promise<Photo> {
  const canvas = document.createElement('canvas');
  drawFace(canvas, { width: WIDTH, height: HEIGHT, ...options });

  const blob = await new Promise<Blob>((resolve, reject) => {
    // PNG: the enamel sampler and the tooth matcher both read colour directly,
    // and JPEG artefacts around the high-contrast interdental gaps are exactly
    // the detail they key on.
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('Could not build the demo photo'))),
      'image/png',
    );
  });

  return { url: URL.createObjectURL(blob), width: WIDTH, height: HEIGHT };
}
