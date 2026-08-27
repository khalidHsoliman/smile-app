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
  score: number;
}

/**
 * Build the four tones from the enamel-like pixels in `pixels`.
 *
 * Selection is *relative*, not threshold-based. Fixed gates (originally
 * luma > 70, saturation < 0.42) worked in even light but rejected every pixel
 * of warm-lit or naturally yellowed teeth, so real photos silently fell back
 * to the generic white default -- which is exactly the colour mismatch the
 * sampler exists to prevent. Enamel cannot be defined by absolute numbers
 * across cameras and lighting; what holds everywhere is that within the mouth
 * it is the brightest, least-saturated tissue. So pixels are *scored* against
 * each other and the top slice taken, whatever its absolute values are.
 */
function paletteFrom(pixels: ImageData): ToothPalette | null {
  const scored: Sample[] = [];
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

    // Loose gates only for the unambiguous: the dark oral cavity and heavily
    // saturated lip/gum pixels. Everything else competes on score.
    if (luma < 50 || saturation > 0.6) continue;

    // Brightness rewarded, saturation beyond a mild enamel warmth penalised.
    // The penalty weight is what separates warm enamel (kept) from gum and
    // lip tissue at similar brightness (rejected).
    scored.push({
      r,
      g,
      b,
      luma,
      score: luma - 300 * Math.max(0, saturation - 0.12),
    });
  }

  // Too few usable pixels means a closed or shadowed mouth -- better to keep
  // the default than to invent a colour from a handful of samples.
  if (scored.length < 40) return null;

  // The top third by score is the enamel, whatever this photo's lighting did
  // to its absolute values.
  scored.sort((a, b) => b.score - a.score);
  const candidates = scored.slice(0, Math.max(40, Math.floor(scored.length * 0.34)));

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

/**
 * Build a coherent palette from one base colour.
 *
 * The four tones of a tooth are not independent: the cervical third is warmer
 * and darker because dentine shows through thinner enamel, and the incisal edge
 * is cooler and slightly darker because it has no dentine behind it. Deriving
 * them from the base keeps any hand-picked shade physically plausible.
 *
 * `brightness` shifts the whole set, -40 to +40 in 0-255 units.
 */
export function paletteFromBase(base: string, brightness = 0): ToothPalette {
  const rgb = fromHex(base);
  const lifted: Rgb = {
    r: rgb.r + brightness,
    g: rgb.g + brightness,
    b: rgb.b + brightness,
  };

  return {
    base: toHex(lifted),
    cervical: toHex(shift(lifted, { luma: -0.07, warmth: 1.1 })),
    highlight: toHex(shift(lifted, { luma: 0.09, warmth: 0.1 })),
    incisal: toHex(shift(lifted, { luma: -0.06, warmth: -0.5 })),
  };
}

/**
 * The dark of the mouth, behind the design.
 *
 * A design has to cover the teeth it replaces, and covering them with the
 * design alone is not enough: wherever the new arch is narrower, shorter or set
 * back from the old one, the patient's original teeth show around its edge and
 * the mock-up reads as two sets of teeth rather than one. Painting this behind
 * the design closes that gap.
 *
 * Derived from the sampled cervical tone rather than fixed, so the shadow
 * carries the photograph's own warmth -- a flat charcoal reads as a hole cut in
 * the picture. Warmer and redder than a plain dimming, because the mouth's
 * shadow is lit through lip and gingiva.
 */
export function oralShadowFrom(palette: ToothPalette): string {
  const { r, g, b } = fromHex(palette.cervical);
  const dim = 0.22;
  return toHex({ r: r * dim, g: g * dim * 0.9, b: b * dim * 0.86 });
}

/**
 * Relative luminance of a hex colour, 0..1.
 *
 * The Rec.601 weights, matching what `feColorMatrix type="saturate" values="0"`
 * uses -- the blend pass rescales the photograph about this value, so the two
 * have to agree on what "the same brightness" means or the design shifts.
 */
export function luminanceOf(hex: string): number {
  const { r, g, b } = fromHex(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Parse `#rrggbb`. Falls back to the default base on anything malformed. */
function fromHex(hex: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return fromHex(DEFAULT_PALETTE.base);
  const n = parseInt(match[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

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
