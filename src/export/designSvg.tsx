import { renderToStaticMarkup } from 'react-dom/server';
import type { FitResult } from '../domain/fitting.js';
import type { FaceFrame, FacialReferences } from '../domain/faceFrame.js';
import type { ToothPalette } from '../vision/sampleToothColor.js';
import { ToothLayer } from '../features/design/ToothLayer.js';

export interface DesignSvgOptions {
  /** The photo, already inlined as a data URI (see `inlinePhoto`). */
  photoHref: string;
  /** The photo's size. Rotation is baked into the pixels, so this is final. */
  size: { width: number; height: number };
  /** Omit the design entirely, for the "before" snapshot. */
  fit: FitResult | null;
  frame: FaceFrame | null;
  refs: FacialReferences | null;
  palette: ToothPalette;
  opacity: number;
  masked: boolean;
  /** Carry the photograph's own light onto the design (see `ToothLayer`). */
  blend: boolean;
}

/**
 * Build the standalone SVG for a snapshot (spec 8.3).
 *
 * The tooth layer is rendered through the very same `ToothLayer` component the
 * screen uses, so an exported image cannot drift from what the clinician
 * approved -- which would be the worst possible bug in a patient-facing
 * deliverable.
 *
 * The output is self-contained: the photo is a data URI and the styles are
 * inlined, because a detached SVG document cannot resolve the page's
 * stylesheet or an object URL.
 */
export function buildDesignSvg(options: DesignSvgOptions): string {
  const { photoHref, size, fit, frame, refs, palette, opacity, masked, blend } =
    options;

  const layer =
    fit && frame && refs
      ? renderToStaticMarkup(
          <ToothLayer
            fit={fit}
            frame={frame}
            refs={refs}
            palette={palette}
            opacity={opacity}
            masked={masked}
            photo={{ href: photoHref, width: size.width, height: size.height }}
            blend={blend}
          />,
        )
      : '';


  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
    ` width="${size.width}" height="${size.height}"`,
    ` viewBox="0 0 ${size.width} ${size.height}">`,
    `<style>${TOOTH_STYLES}</style>`,
    `<image href="${photoHref}" xlink:href="${photoHref}"`,
    ` x="0" y="0" width="${size.width}" height="${size.height}"/>`,
    layer,
    `</svg>`,
  ].join('');
}

/**
 * The tooth styles, duplicated from `index.css` because a detached SVG cannot
 * see the document's stylesheet.
 *
 * Kept deliberately small -- only what the tooth layer needs. If these drift
 * from the stylesheet the exported image stops matching the screen, so they are
 * the only rules allowed to live in two places.
 */
const TOOTH_STYLES = `
.tooth[data-auxiliary]{display:none}
.tooth__body,.tooth__proximal,.tooth__highlight{stroke:none}
.teeth{isolation:isolate}
.teeth__blend{mix-blend-mode:multiply}
.tooth__edge{fill:none;stroke:#9c8f79;stroke-width:0.9;stroke-opacity:0.5;vector-effect:non-scaling-stroke}
`.trim();
