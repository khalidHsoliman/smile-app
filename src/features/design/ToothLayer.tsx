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
import {
  luminanceOf,
  oralShadowFrom,
  type ToothPalette,
} from '../../vision/sampleToothColor.js';

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
 * Four things matter here.
 *
 * **The lip mask.** Teeth are clipped to the mouth aperture, so the design
 * appears *inside* the mouth rather than painted over the lips. Without it
 * every design reads as pasted on, which is the single most obvious tell of an
 * amateur mock-up.
 *
 * **The backdrop.** The teeth the design replaces have to disappear, and the
 * design covering them is not the same as the design hiding them -- see
 * `BACKDROP_DILATION`.
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

  /*
   * One central incisor's width, in image pixels. The blend's blur is set in
   * these rather than in pixels or in a share of the design's own box: the box
   * is twice as tall when both arches are designed and half as wide when six
   * teeth are selected instead of twelve, so anything scaled off it changes the
   * look of the blend depending on what the clinician happened to select.
   */
  const toothWidth = useMemo(() => centralWidthInPixels(placed), [placed]);

  const useBlend = blend && photo !== undefined && designBounds !== null;
  const shadow = useMemo(() => oralShadowFrom(palette), [palette]);

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

      {designBounds !== null && (
        <defs>
          {/*
            The teeth themselves, as a clip. Both full-arch passes need it --
            the grain must not speckle the lips and the blend must not touch the
            photo between the teeth. Auxiliary teeth are excluded here rather
            than hidden with CSS: `display:none` on a clip path's child is not
            reliably honoured, and a stray injected anchor would open a hole.
          */}
          <clipPath id={`${clipId}-teeth`} clipPathUnits="userSpaceOnUse">
            {placed
              .filter(({ tooth }) => !tooth.auxiliary)
              .map(({ tooth, matrix }) => (
                <path key={tooth.universal} d={tooth.outline} transform={matrix} />
              ))}
          </clipPath>
          {grainFilter(`${clipId}-grain`, designBounds, toothWidth)}
          {useBlend &&
            blendFilter(`${clipId}-shading`, palette, designBounds, toothWidth)}
        </defs>
      )}

      <g
        className="teeth"
        opacity={opacity}
        clipPath={useMask ? `url(#${clipId})` : undefined}
      >
        {/*
          The old teeth, painted out. Drawn from the design's own outlines
          rather than over the whole aperture: the aperture also contains
          gingiva on a high smile line, and blanking that would erase the one
          tissue a smile design must never invent.
        */}
        <g className="teeth__backdrop" fill={shadow} stroke={shadow}>
          {placed
            .filter(({ tooth }) => !tooth.auxiliary)
            .map(({ tooth, matrix }) => (
              <path
                key={tooth.universal}
                d={tooth.outline}
                transform={matrix}
                strokeWidth={BACKDROP_DILATION}
              />
            ))}
        </g>

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
                Four passes over the same outline: the enamel body, the
                proximal fall-off that separates neighbours, the broad labial
                sheen, and the glint on top of that. Each one clips itself to
                the tooth by being the tooth.
              */}
              <path className="tooth__body" d={tooth.outline} fill={`url(#${shading}-body)`} />
              <path className="tooth__proximal" d={tooth.outline} fill={`url(#${shading}-proximal)`} />
              <path className="tooth__highlight" d={tooth.outline} fill={`url(#${shading}-highlight)`} />
              <path className="tooth__glint" d={tooth.outline} fill={`url(#${shading}-glint)`} />
              <path className="tooth__edge" d={tooth.outline} />
            </g>
          );
        })}

        {/*
          Enamel grain, over the whole arch in one pass rather than per tooth:
          it is a property of the material, not of any one crown, and a single
          rect over the design costs one filter instead of a dozen.
        */}
        {designBounds !== null && (
          <rect
            className="teeth__grain"
            x={designBounds.x}
            y={designBounds.y}
            width={designBounds.width}
            height={designBounds.height}
            clipPath={`url(#${clipId}-teeth)`}
            filter={`url(#${clipId}-grain)`}
          />
        )}

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
 * How far the backdrop is grown beyond the design's own silhouette, in
 * central-incisor widths -- so about a quarter of a millimetre on each side.
 *
 * The design's teeth are opaque, so anywhere one covers an old tooth the old
 * tooth is already gone. What is left is the rim: wherever the new arch is
 * narrower than the old, or set back from it, or the old tooth is rotated out
 * from under it, a sliver of the original shows around the edge and the result
 * reads as two sets of teeth overlaid. Painting the silhouette slightly
 * oversized underneath swallows that rim.
 *
 * Drawn as a stroke on the same paths rather than as a computed offset
 * outline: it dilates in every direction at once, it costs nothing, and it
 * scales with the tooth because the placement matrix scales the stroke.
 *
 * Kept small on purpose. It also grows a little *up* past the gum line, where
 * it reads as the shadow at the gingival margin -- true at a quarter of a
 * millimetre and a dark halo at two.
 */
const BACKDROP_DILATION = 0.06;

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
 * The size of the enamel grain, in central-incisor widths.
 *
 * Wider than it is tall, on purpose. Enamel is not evenly speckled: it carries
 * perikymata, the fine horizontal ridges left by the tooth's own growth, and
 * they are what a photograph of a real tooth shows under a flash. Isotropic
 * noise reads as film grain or dirt on the lens; noise stretched along the
 * tooth's width reads as surface.
 *
 * At these periods the features are roughly a millimetre across and a third of
 * one tall on an 8.5mm central -- visible as texture at report resolution,
 * invisible as individual specks.
 */
const GRAIN_PERIOD = { x: 0.115, y: 0.038 } as const;

/**
 * How deep the grain cuts, as a fraction of the tooth's drawn colour.
 *
 * Small, and it has to be. The grain multiplies, and multiplying can only take
 * light away, so its *average* is a dimming of half this much however finely it
 * is tuned. Three or four percent is texture; more is a dirty tooth, and this
 * arch has already been dingy once.
 */
const GRAIN_DEPTH = 0.07;

/**
 * The enamel grain, as a filter over the design.
 *
 * Turbulence rather than a tiled image: `baseFrequency` is specified in user
 * units, so the pattern is defined geometrically and rasterizes the same at any
 * output resolution -- the same reason the gloss is built from gradients rather
 * than from a lighting filter. It also means no texture asset to license, which
 * is not nothing given where the demo photographs came from.
 *
 * The noise is desaturated and remapped into a narrow band just below white, so
 * multiplying it over the design modulates the enamel instead of colouring it.
 */
function grainFilter(id: string, region: Rect, toothWidth: number) {
  // One period in pixels, inverted -- `baseFrequency` is cycles per user unit.
  const frequency = (period: number) =>
    toothWidth > 0 ? 1 / (period * toothWidth) : 0;

  const k = GRAIN_DEPTH;
  const luma = [0.299 * k, 0.587 * k, 0.114 * k, 0, 1 - k];
  // Alpha forced to 1: turbulence varies alpha too, and a multiply pass with
  // holes in it would let the backdrop through exactly as the tooth body did.
  const matrix = [...luma, ...luma, ...luma, 0, 0, 0, 0, 1].join(' ');

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
      <feTurbulence
        type="fractalNoise"
        baseFrequency={`${frequency(GRAIN_PERIOD.x)} ${frequency(GRAIN_PERIOD.y)}`}
        numOctaves={3}
        seed={7}
      />
      <feColorMatrix type="matrix" values={matrix} />
    </filter>
  );
}

/**
 * How far the shading map is blurred, in central-incisor widths.
 *
 * Without this the blend is worse than useless. The photograph's light is what
 * the design wants; the photograph's *detail* is the patient's existing teeth,
 * and multiplying that back over the design prints their interdental lines,
 * their chips and their old incisal edges straight onto the new ones -- the
 * originals showing through the very teeth meant to replace them.
 *
 * Blurring separates the two. Light varies slowly across a mouth: the shadow
 * under the upper lip, the fall-off into the buccal corridor. Tooth detail
 * varies at the scale of a tooth. Set to roughly a fifth of a crown's width,
 * which flattens the detail while leaving the gradient that made the pass worth
 * having.
 */
const BLEND_BLUR = 0.22;

/**
 * How hard the shading map swings either side of neutral.
 *
 * The map is centred so that photograph-as-bright-as-its-own-teeth leaves the
 * design untouched, brighter lightens it and darker darkens it. That centring
 * is the important part, and it replaced a version that could only darken:
 * multiplying by a map that tops out at 1.0 means every pixel either dims or
 * stays put, so the arch as a whole could only ever come out duller than it was
 * drawn. It duly did.
 *
 * Below 1.0 because the design covers ground the original teeth did not -- it
 * runs up under the lip and past the old incisal edges, where the photograph is
 * lip and shadow rather than enamel. Taking that at face value would drag the
 * top of every crown down toward the lip's own darkness.
 */
const SHADING_CONTRAST = 0.7;

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
function blendFilter(
  id: string,
  palette: ToothPalette,
  region: Rect,
  toothWidth: number,
) {
  // Where the photo's own enamel sits on the 0..1 scale -- the level that must
  // come through as "unchanged". Guarded: a near-black sample would put the
  // centring somewhere absurd.
  const mid = Math.max(0.25, luminanceOf(palette.base));
  const k = SHADING_CONTRAST;

  /*
   * Desaturate and recentre in one matrix. Each output channel takes the
   * Rec.601 luminance of the input and maps `mid` to 0.5 -- the value soft
   * light leaves its backdrop alone at -- so the design is lightened where the
   * photograph is brighter than its own enamel and darkened where it is darker.
   *
   * One `feColorMatrix` rather than a colour matrix plus a component transfer:
   * arithmetically identical, over a full-resolution photograph, in one pass
   * instead of two.
   */
  const row = [0.299 * k, 0.587 * k, 0.114 * k, 0, 0.5 - k * mid];
  const matrix = [...row, ...row, ...row, 0, 0, 0, 1, 0].join(' ');

  const blur = toothWidth * BLEND_BLUR;
  // A Gaussian is negligible past three standard deviations, so the region has
  // to carry that much extra on every side. Short of it, the blur reaches
  // outside the region, finds transparent black, and draws a dark border around
  // the whole design.
  const margin = 3 * blur + 1;

  return (
    <filter
      id={id}
      filterUnits="userSpaceOnUse"
      x={region.x - margin}
      y={region.y - margin}
      width={region.width + 2 * margin}
      height={region.height + 2 * margin}
      colorInterpolationFilters="sRGB"
    >
      <feColorMatrix type="matrix" values={matrix} />
      <feGaussianBlur stdDeviation={blur} />
    </filter>
  );
}

/**
 * The measured width of one central incisor, in image pixels.
 *
 * The outlines are authored with the central at 1.0 wide, so the length of the
 * placement matrix's x column is that width in pixels. Auxiliary teeth are
 * skipped -- an injected anchor can be scaled to nothing.
 */
function centralWidthInPixels(
  placed: readonly { tooth: PlacedTooth; transform: Matrix2D }[],
): number {
  for (const { tooth, transform } of placed) {
    if (tooth.auxiliary) continue;
    const width = Math.hypot(transform.a, transform.b);
    if (width > 0) return width;
  }
  return 0;
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
