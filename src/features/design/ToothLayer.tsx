import { useId, useMemo } from 'react';
import type { FitResult, PlacedTooth } from '../../domain/fitting.js';
import type { FaceFrame, FacialReferences } from '../../domain/faceFrame.js';
import { faceToWorldMatrix } from '../../domain/faceFrame.js';
import {
  applyMatrix,
  compose,
  rotation,
  scaling,
  toSvgMatrix,
  translation,
  vec,
  type Matrix2D,
  type Rect,
  type Vec2,
} from '../../domain/geometry.js';
import { isUpper } from '../../domain/teeth.js';
import { ToothShading } from './ToothShading.js';
import { luminanceOf, type ToothPalette } from '../../vision/sampleToothColor.js';

/** The photograph the design is drawn over, for the blend pass. */
export interface BlendSource {
  /** The photo's href -- an object URL on screen, a data URI when exporting. */
  href: string;
  width: number;
  height: number;
}

interface ToothLayerProps {
  fit: FitResult;
  frame: FaceFrame;
  refs: FacialReferences;
  opacity: number;
  /** Turn the lip mask off, to check the design against the whole arch. */
  masked?: boolean;
  /** Enamel tones, sampled from the photo where possible. */
  palette: ToothPalette;
  /**
   * The photograph, to blend the design into. Omit -- or pass `blend={false}`
   * -- to draw the design flat.
   */
  photo?: BlendSource;
  blend?: boolean;
  /** Teeth currently selected for editing. */
  selection?: readonly number[];
  /** Click handler. Omit to render a non-interactive layer, as export does. */
  onToothClick?: (universal: number, extend: boolean) => void;
}

/**
 * The design layer: template teeth placed on the photo (spec 7.1).
 *
 * Three things matter here.
 *
 * **The lip mask.** Teeth are clipped to the mouth aperture, so the design
 * appears *inside* the mouth rather than painted over the lips. Without it
 * every design reads as pasted on, which is the single most obvious tell of an
 * amateur mock-up.
 *
 * **The blend pass.** See `blendFilter` below -- it is what stops the design
 * reading as a sticker.
 *
 * **Untouched outlines.** Each tooth draws its template path plus a transform,
 * so the source geometry survives for per-tooth editing later (spec 11.6), and
 * the face-frame-to-pixels matrix is built once for the layer, not per tooth.
 */
export function ToothLayer({
  fit,
  frame,
  refs,
  opacity,
  masked = true,
  palette,
  photo,
  blend = true,
  selection,
  onToothClick,
}: ToothLayerProps) {
  const faceToWorld = useMemo(() => faceToWorldMatrix(frame), [frame]);
  const clipId = useId();

  const aperture = refs.mouthAperture;
  const useMask = masked && aperture !== undefined && aperture.length >= 3;
  const selected = new Set(selection ?? []);

  /*
   * Placement is computed once per tooth and reused, because the blend pass
   * needs the same transforms to build its clip. Recomputing them there would
   * be the classic two-copies-of-one-truth bug: any change to placement that
   * missed the second copy would slide the shading off the teeth it shades.
   */
  const placed = useMemo(
    () =>
      fit.teeth.map((tooth) => {
        const transform = compose(placementOf(tooth), faceToWorld);
        return { tooth, transform, matrix: toSvgMatrix(transform) };
      }),
    [fit.teeth, faceToWorld],
  );

  /*
   * Where the design actually is, in image pixels. The blend pass filters the
   * whole photograph, and a filter region left at its default covers the entire
   * image -- twelve megapixels of work, re-run on every frame of a slider drag,
   * for a result that is then clipped down to a few hundred thousand of them.
   * Bounding the region to the teeth is what keeps the design step responsive
   * on a full-resolution photo.
   */
  const designBounds = useMemo(() => boundsOfDesign(placed), [placed]);

  const useBlend = blend && photo !== undefined && designBounds !== null;

  return (
    <>
      {useMask && (
        <defs>
          <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
            <path d={ringPath(aperture)} />
          </clipPath>
        </defs>
      )}

      {/* One gradient set per arch: the gum is at opposite ends of the box. */}
      <ToothShading idPrefix={`${clipId}-upper`} upper palette={palette} />
      <ToothShading idPrefix={`${clipId}-lower`} upper={false} palette={palette} />

      {useBlend && (
        <defs>
          {/*
            The teeth themselves, as a clip -- the blend pass must not touch the
            photo between or around them. Auxiliary teeth are excluded here
            rather than hidden with CSS: `display:none` on a clip path's child
            is not reliably honoured, and a stray injected anchor would open a
            hole in the shading.
          */}
          <clipPath id={`${clipId}-teeth`} clipPathUnits="userSpaceOnUse">
            {placed
              .filter(({ tooth }) => !tooth.auxiliary)
              .map(({ tooth, matrix }) => (
                <path key={tooth.universal} d={tooth.outline} transform={matrix} />
              ))}
          </clipPath>
          {blendFilter(`${clipId}-shading`, palette, designBounds)}
        </defs>
      )}

      <g
        className="teeth"
        opacity={opacity}
        clipPath={useMask ? `url(#${clipId})` : undefined}
      >
        {placed.map(({ tooth, matrix }) => {
          const shading = `${clipId}-${isUpper(tooth.universal) ? 'upper' : 'lower'}`;

          return (
            <g
              key={tooth.universal}
              className="tooth"
              data-universal={tooth.universal}
              data-auxiliary={tooth.auxiliary || undefined}
              data-selected={selected.has(tooth.universal) || undefined}
              data-interactive={onToothClick && !tooth.auxiliary ? '' : undefined}
              transform={matrix}
              onPointerDown={
                onToothClick && !tooth.auxiliary
                  ? (event) => {
                      event.stopPropagation();
                      onToothClick(tooth.universal, event.shiftKey);
                    }
                  : undefined
              }
            >
              {/*
                Three passes over the same outline: the enamel body, the
                proximal fall-off that separates neighbours, and the labial
                highlight on top.
              */}
              <path className="tooth__body" d={tooth.outline} fill={`url(#${shading}-body)`} />
              <path className="tooth__proximal" d={tooth.outline} fill={`url(#${shading}-proximal)`} />
              <path className="tooth__highlight" d={tooth.outline} fill={`url(#${shading}-highlight)`} />
              <path className="tooth__edge" d={tooth.outline} />
            </g>
          );
        })}

        {useBlend && (
          <image
            className="teeth__blend"
            href={photo.href}
            xlinkHref={photo.href}
            x={0}
            y={0}
            width={photo.width}
            height={photo.height}
            clipPath={`url(#${clipId}-teeth)`}
            filter={`url(#${clipId}-shading)`}
            opacity={BLEND_STRENGTH}
          />
        )}

        {/*
          Selection outlines last, over the blend: they are interface, not
          design, and must stay legible however dark the shading goes.
        */}
        {placed
          .filter(({ tooth }) => selected.has(tooth.universal))
          .map(({ tooth, matrix }) => (
            <path
              key={tooth.universal}
              className="tooth__selected"
              d={tooth.outline}
              transform={matrix}
            />
          ))}
      </g>
    </>
  );
}

/**
 * Local placement: scale the outline, rotate it along the arch, then move it to
 * its slot -- all still in face units. Composing with the face-to-world matrix
 * converts to image pixels in one step.
 */
function placementOf(tooth: PlacedTooth) {
  return compose(
    compose(scaling(tooth.scaleX, tooth.scaleY), rotation(tooth.rotation)),
    translation(tooth.position.x, tooth.position.y),
  );
}

/**
 * How much of the photograph's shading to carry onto the design.
 *
 * Short of the whole of it. The photo's light is the right *shape* but not
 * quite the right depth for teeth that are, by construction, longer and fuller
 * than the ones underneath -- and a design is a proposal, so it should read a
 * little cleaner than the photograph it sits in.
 */
const BLEND_STRENGTH = 0.75;

/**
 * The darkest the shading may take a tooth, as a fraction of its drawn colour.
 *
 * Without a floor, a design tooth that covers something genuinely dark in the
 * photograph -- the oral cavity behind a missing tooth, a black triangle, a
 * shadowed diastema -- would be multiplied down to near black. Those are
 * precisely the places a smile design exists to fill in, so the one thing the
 * blend must never do is reopen them. At this floor a hole reads as a tooth in
 * deep shadow, which is honest, rather than as no tooth at all.
 */
const SHADING_FLOOR = 0.45;

/**
 * The filter that turns the photograph into a shading map.
 *
 * This is what the whole blend pass is for. A design drawn as flat vector
 * shapes over a photograph reads as a sticker no matter how good its gradients
 * are, because the photograph has light in it and the design does not: the
 * shadow the upper lip casts across the top of the teeth, the fall-off into the
 * buccal corridor, the darkening between the arches. Painting over it discards
 * all of that.
 *
 * So the photograph is reduced to greyscale and rescaled about the enamel tone
 * we sampled from it, giving a *ratio* image -- 1.0 where the photo is as
 * bright as its own teeth, less where it is darker. Multiplied over the design,
 * that returns the photograph's own light to it while leaving the shape and
 * colour the clinician chose intact.
 *
 * `color-interpolation-filters="sRGB"` is not optional. The default is
 * linearRGB, which would move the midpoint the rescaling is centred on and
 * quietly darken every design.
 */
function blendFilter(id: string, palette: ToothPalette, region: Rect) {
  // Where the photo's own enamel sits on the 0..1 scale -- the level that must
  // come through as "unchanged". Guarded: a near-black sample would divide the
  // slope into absurdity.
  const mid = Math.max(0.25, luminanceOf(palette.base));
  const k = (1 - SHADING_FLOOR) / mid;

  /*
   * Desaturating and rescaling in one matrix rather than a `feColorMatrix`
   * followed by a `feComponentTransfer`. Each output channel takes the Rec.601
   * luminance of the input, scaled by `k`, with the floor supplied by the
   * constant column -- arithmetically identical to the two-step version, over a
   * full-resolution photograph, in one pass instead of two.
   */
  const row = [0.299 * k, 0.587 * k, 0.114 * k, 0, SHADING_FLOOR];
  const matrix = [...row, ...row, ...row, 0, 0, 0, 1, 0].join(' ');

  return (
    <filter
      id={id}
      filterUnits="userSpaceOnUse"
      x={region.x}
      y={region.y}
      width={region.width}
      height={region.height}
      colorInterpolationFilters="sRGB"
    >
      <feColorMatrix type="matrix" values={matrix} />
    </filter>
  );
}

/**
 * The bounding box of the visible design, in image pixels.
 *
 * Taken from the outlines' own control points rather than from an estimate
 * around each tooth's position: a Bezier stays inside the hull of its control
 * points, so this is a true bound, and it cannot silently start clipping the
 * shading if a future template draws a longer tooth.
 *
 * Null when nothing visible is placed, which turns the blend pass off rather
 * than handing the filter an empty region.
 */
function boundsOfDesign(
  placed: readonly { tooth: PlacedTooth; transform: Matrix2D }[],
): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const { tooth, transform } of placed) {
    if (tooth.auxiliary) continue;
    for (const point of controlPoints(tooth.outline)) {
      const { x, y } = applyMatrix(transform, point);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null;

  // A pixel of margin, so the filter's edge never lands on the clip's own
  // antialiased boundary.
  const pad = 1;
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + 2 * pad,
    height: maxY - minY + 2 * pad,
  };
}

/**
 * Every coordinate pair in a tooth outline.
 *
 * The outlines are built from `M`, `C` and `Z` alone (see `buildOutline`), and
 * both commands that carry numbers carry them as x,y pairs -- so pulling the
 * numbers out in order is enough, with no path parser.
 */
function controlPoints(d: string): Vec2[] {
  const numbers = d.match(/-?\d*\.?\d+(?:e-?\d+)?/g)?.map(Number) ?? [];
  const points: Vec2[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    points.push(vec(numbers[i]!, numbers[i + 1]!));
  }
  return points;
}

/** A closed SVG path through a ring of points. */
function ringPath(ring: readonly Vec2[]): string {
  return (
    ring.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'
  );
}
