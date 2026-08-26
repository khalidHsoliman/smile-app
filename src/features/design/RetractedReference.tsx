import { useMemo } from 'react';
import { useAppStore } from '../../state/store.js';
import { lipBoxFrom } from '../../domain/lipBox.js';
import { applyMatrix, invert, type Rect } from '../../domain/geometry.js';

/**
 * The retracted photograph as a reference beside the design.
 *
 * The retracted view is the anatomical truth -- the patient's real tooth
 * shapes and positions without the lips in the way -- and the design step is
 * where that truth is most useful: while nudging a tooth, the clinician wants
 * to glance at what actually exists. Until now the photo appeared only in the
 * report, which is after every decision it could have informed.
 *
 * When an alignment exists, the view is cropped to the mouth: the smile
 * photo's lip box is carried through the inverse of the matching transform, so
 * the reference shows the teeth at a useful size instead of a whole face.
 * Without an alignment the full photo is shown -- a guessed crop that missed
 * the mouth would be worse than no crop.
 */
export function RetractedReference() {
  const retracted = useAppStore((s) => s.photos.retracted);
  const smile = useAppStore((s) => s.photos.smile);
  const refs = useAppStore((s) => s.face.refs);
  const transform = useAppStore((s) => s.matching.transform);

  const size = retracted;

  const crop: Rect | null = useMemo(() => {
    if (!retracted || !size || !transform || !smile || !refs?.mouthAperture) {
      return null;
    }

    const smileSize = smile;
    const box = lipBoxFrom(refs.mouthAperture, smileSize);
    if (!box) return null;

    // Carry the smile photo's lip box into retracted coordinates. The
    // alignment maps retracted -> smile, so the crop needs its inverse; the
    // mapped rectangle is rotated, so its axis-aligned bounds are taken with
    // a margin.
    const toRetracted = invert(transform);
    const corners = [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x, y: box.y + box.height },
      { x: box.x + box.width, y: box.y + box.height },
    ].map((p) => applyMatrix(toRetracted, p));

    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const pad = 0.08;
    const w = (Math.max(...xs) - Math.min(...xs)) * (1 + pad * 2);
    const h = (Math.max(...ys) - Math.min(...ys)) * (1 + pad * 2);
    const x = Math.max(0, Math.min(...xs) - w * pad);
    const y = Math.max(0, Math.min(...ys) - h * pad);

    return {
      x,
      y,
      width: Math.min(w, size.width - x),
      height: Math.min(h, size.height - y),
    };
  }, [retracted, size?.width, size?.height, transform, smile, refs?.mouthAperture]);

  if (!retracted || !size) return null;

  const view = crop ?? { x: 0, y: 0, width: size.width, height: size.height };

  return (
    <div className="reference">
      <span className="slider__name">
        Retracted reference
        <em className="reference__hint">
          {crop ? ' · cropped via the alignment' : ' · unaligned, full photo'}
        </em>
      </span>
      <svg
        className="reference__svg"
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        preserveAspectRatio="xMidYMid meet"
        aria-label="Retracted photograph, for reference"
      >
        <image
          href={retracted.url}
          x={0}
          y={0}
          width={size.width}
          height={size.height}
        />
      </svg>
    </div>
  );
}
