import { useId, useMemo } from 'react';
import type { FitResult } from '../../domain/fitting.js';
import type { FaceFrame, FacialReferences } from '../../domain/faceFrame.js';
import { faceToWorldMatrix } from '../../domain/faceFrame.js';
import {
  compose,
  rotation,
  scaling,
  toSvgMatrix,
  translation,
  type Vec2,
} from '../../domain/geometry.js';
import { isUpper } from '../../domain/teeth.js';
import { ToothShading } from './ToothShading.js';

interface ToothLayerProps {
  fit: FitResult;
  frame: FaceFrame;
  refs: FacialReferences;
  opacity: number;
  /** Turn the lip mask off, to check the design against the whole arch. */
  masked?: boolean;
}

/**
 * The design layer: template teeth placed on the photo (spec 7.1).
 *
 * Two things matter here.
 *
 * **The lip mask.** Teeth are clipped to the mouth aperture, so the design
 * appears *inside* the mouth rather than painted over the lips. Without it
 * every design reads as pasted on, which is the single most obvious tell of an
 * amateur mock-up.
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
}: ToothLayerProps) {
  const faceToWorld = useMemo(() => faceToWorldMatrix(frame), [frame]);
  const clipId = useId();

  const aperture = refs.mouthAperture;
  const useMask = masked && aperture !== undefined && aperture.length >= 3;

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
      <ToothShading idPrefix={`${clipId}-upper`} upper />
      <ToothShading idPrefix={`${clipId}-lower`} upper={false} />

      <g
        className="teeth"
        opacity={opacity}
        clipPath={useMask ? `url(#${clipId})` : undefined}
      >
        {fit.teeth.map((tooth) => {
          // Local placement: scale the outline, rotate it along the arch, then
          // move it to its slot -- all still in face units. Composing with
          // faceToWorld converts to image pixels in one step.
          const placement = compose(
            compose(
              scaling(tooth.scaleX, tooth.scaleY),
              rotation(tooth.rotation),
            ),
            translation(tooth.position.x, tooth.position.y),
          );

          const matrix = toSvgMatrix(compose(placement, faceToWorld));
          const shading = `${clipId}-${isUpper(tooth.universal) ? 'upper' : 'lower'}`;

          return (
            <g
              key={tooth.universal}
              className="tooth"
              data-universal={tooth.universal}
              data-auxiliary={tooth.auxiliary || undefined}
              transform={matrix}
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
      </g>
    </>
  );
}

/** A closed SVG path through a ring of points. */
function ringPath(ring: readonly Vec2[]): string {
  return (
    ring.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'
  );
}
