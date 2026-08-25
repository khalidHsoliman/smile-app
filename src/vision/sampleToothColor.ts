/**
 * Sampling the patient's own tooth colour from the photograph.
 *
 * A design rendered in a generic white sits badly against the patient's face:
 * skin tone, lighting and white balance all shift what reads as a natural
 * tooth. Sampling the photo makes the design match the person in it, and it is
 * the one rendering trick that most reliably makes a 2D mock-up look real.
 * exocad ships exactly this as base and highlight eyedroppers.
 *
 * **This is an approximation, and the UI says so.** The colour in a photograph
 * depends on the camera, the lighting and the display; it is not a shade match
 * and must never be presented as one. Shade selection is a clinical procedure
 * done against a physical shade guide.
 */

import type { Vec2 } from '../domain/geometry.js';

export interface ToothPalette {
  /** Mid-tone of the enamel body. */
  base: string;
  /** The brighter labial highlight. */
  highlight: string;
  /** Warmer, more saturated tone near the gum. */
  cervical: string;
  /** Cooler translucent tone at the incisal edge. */
  incisal: string;
}

/**
 * The default palette, used before a photo is sampled and whenever sampling
 * fails. A neutral, slightly warm enamel that looks acceptable on most skin
 * tones without matching any of them particularly well.
 */
export const DEFAULT_PALETTE: ToothPalette = {
  base: '#f4ece0',
  highlight: '#ffffff',
  cervical: '#e8d9bd',
  incisal: '#e4e8ea',
};

/**
 * Sample enamel colour from the visible teeth inside the mouth aperture.
 *
 * The aperture contains teeth, lips, shadow and often the tongue, so a plain
 * average would come out muddy brown. Instead the brightest, least saturated
 * pixels are taken -- that is what enamel is, and it separates cleanly from
 * the darker, more saturated lips and oral cavity.
 *
 * Returns `null` when there is nothing usable to sample, so the caller can keep
 * the default rather than showing a colour derived from shadow.
 */
export function sampleToothColor(
  image: CanvasImageSource,
  aperture: readonly Vec2[],
): ToothPalette | null {
  if (aperture.length < 3) return null;

  const box = boundsOf(aperture);
  if (box.width < 4 || box.height < 4) return null;

  // Sample at a modest fixed resolution: enough pixels for a stable statistic,
  // cheap enough to run on every photo without a worker.
  const scale = Math.min(1, 160 / Math.max(box.width, box.height));
  const w = Math.max(1, Math.round(box.width * scale));
  const h = Math.max(1, Math.round(box.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  // Clip to the aperture so no lip or cheek pixels reach the sample.
  ctx.save();
  ctx.beginPath();
  aperture.forEach((p, i) => {
    const x = (p.x - box.x) * scale;
    const y = (p.y - box.y) * scale;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(
    image,
    box.x,
    box.y,
    box.width,
    box.height,
    0,
    0,
    w,
    h,
  );
  ctx.restore();

  let pixels: ImageData;
  try {
    pixels = ctx.getImageData(0, 0, w, h);
  } catch {
    // A cross-origin image taints the canvas. Object URLs are same-origin, so
    // this should not happen -- but a tainted canvas throws rather than
    // returning garbage, and the default palette is the right fallback.
    return null;
  }

  return paletteFrom(pixels);
}

interface Sample {
  r: number;
  g: number;
  b: number;
  luma: number;
}

/** Build the four tones from the enamel-like pixels in `pixels`. */
function paletteFrom(pixels: ImageData): ToothPalette | null {
  const candidates: Sample[] = [];
  const data = pixels.data;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a < 250) continue; // outside the clip

    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;

    // Enamel is bright and close to neutral. Lips and the oral cavity are
    // either much darker or much more saturated toward red.
    if (luma < 70 || saturation > 0.42) continue;
    candidates.push({ r, g, b, luma });
  }

  // Too few usable pixels means a closed or shadowed mouth -- better to keep
  // the default than to invent a colour from a handful of samples.
  if (candidates.length < 40) return null;

  candidates.sort((a, b) => a.luma - b.luma);

  // Percentiles rather than min/max: the extremes are specular glare and
  // shadow, neither of which is the tooth's colour.
  const base = averageAt(candidates, 0.45, 0.75);
  const cervical = averageAt(candidates, 0.15, 0.4);
  const highlight = averageAt(candidates, 0.88, 0.99);

  // The incisal edge is translucent -- it takes the dark of the mouth behind
  // it, so it is a cooler, slightly darker version of the base rather than a
  // colour present in the photo.
  const incisal = shift(base, { luma: -0.06, warmth: -0.5 });

  return {
    base: toHex(base),
    cervical: toHex(shift(cervical, { luma: -0.02, warmth: 0.35 })),
    highlight: toHex(highlight),
    incisal: toHex(incisal),
  };
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Mean colour of the samples between two percentiles of the luma ordering. */
function averageAt(sorted: Sample[], from: number, to: number): Rgb {
  const lo = Math.floor(sorted.length * from);
  const hi = Math.max(lo + 1, Math.floor(sorted.length * to));

  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = lo; i < hi; i++) {
    r += sorted[i]!.r;
    g += sorted[i]!.g;
    b += sorted[i]!.b;
  }
  const n = hi - lo;
  return { r: r / n, g: g / n, b: b / n };
}

/**
 * Nudge a colour's brightness and warmth. `warmth` moves red and blue in
 * opposite directions, which is what separates the warm cervical third from
 * the cool incisal edge.
 */
function shift(c: Rgb, by: { luma: number; warmth: number }): Rgb {
  const k = 1 + by.luma;
  const w = by.warmth * 12;
  return { r: c.r * k + w, g: c.g * k, b: c.b * k - w };
}

const clamp255 = (n: number): number =>
  Math.max(0, Math.min(255, Math.round(n)));

const toHex = (c: Rgb): string =>
  '#' +
  [c.r, c.g, c.b]
    .map((v) => clamp255(v).toString(16).padStart(2, '0'))
    .join('');

function boundsOf(points: readonly Vec2[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
