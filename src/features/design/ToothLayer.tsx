import { useMemo } from 'react';
import type { FitResult } from '../../domain/fitting.js';
import type { FaceFrame } from '../../domain/faceFrame.js';
import { faceToWorldMatrix } from '../../domain/faceFrame.js';
import {
  compose,
  rotation,
  scaling,
  toSvgMatrix,
  translation,
} from '../../domain/geometry.js';

interface ToothLayerProps {
  fit: FitResult;
  frame: FaceFrame;
  opacity: number;
}

/**
 * The design layer: template teeth placed on the photo (spec 7.1).
 *
 * Each tooth is drawn from its untouched template outline plus a transform, so
 * the source geometry survives for per-tooth editing later (spec 11.6). The
 * face-frame-to-pixels matrix is built once for the whole layer rather than per
 * tooth (spec 5.2).
 */
export function ToothLayer({ fit, frame, opacity }: ToothLayerProps) {
  const faceToWorld = useMemo(() => faceToWorldMatrix(frame), [frame]);

  return (
    <g className="teeth" opacity={opacity}>
      {fit.teeth.map((tooth) => {
        // Local placement: scale the outline, rotate it along the arch, then
        // move it to its slot -- all still in face units. Composing with
        // faceToWorld converts the result to image pixels in one step.
        const placement = compose(
          compose(
            scaling(tooth.scaleX, tooth.scaleY),
            rotation(tooth.rotation),
          ),
          translation(tooth.position.x, tooth.position.y),
        );

        return (
          <path
            key={tooth.universal}
            className="tooth"
            data-universal={tooth.universal}
            data-auxiliary={tooth.auxiliary || undefined}
            d={tooth.outline}
            transform={toSvgMatrix(compose(placement, faceToWorld))}
          />
        );
      })}
    </g>
  );
}
