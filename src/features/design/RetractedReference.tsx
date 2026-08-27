import { useMemo } from 'react';
import { useAppStore } from '../../state/store.js';
import { lipBoxFrom } from '../../domain/lipBox.js';
import { applyMatrix, invert, type Rect } from '../../domain/geometry.js';
import { alignedFaceFrame, withoutAperture } from '../../domain/alignedFrame.js';
import type { FitResult } from '../../domain/fitting.js';
import { ToothLayer } from './ToothLayer.js';

/**
 * The retracted photograph beside the design, with the design on it.
 *
 * Two jobs. It is the anatomical truth -- the patient's real tooth shapes
 * without the lips in the way -- while they shape the new ones. And it is the
 * only place the retracted alignment can actually be judged: this is exactly
 * what the report's retracted "after" will show, so an alignment that is
 * visibly off is visibly off *here*, where it can be corrected, rather than
 * three steps later in a PDF.
 *
 * That is why the nudge controls live here rather than only in the matching
 * step. Aligning two photographs against each other is guesswork until you can
 * see the thing you are aligning them for.
 */
export function RetractedReference({ fit }: { fit: FitResult | null }) {
  const retracted = useAppStore((s) => s.photos.retracted);
  const smile = useAppStore((s) => s.photos.smile);
  const refs = useAppStore((s) => s.face.refs);
  const frame = useAppStore((s) => s.face.frame);
  const transform = useAppStore((s) => s.matching.transform);
  const palette = useAppStore((s) => s.design.palette);
  const photoBlend = useAppStore((s) => s.design.photoBlend);
  const nudgeMatch = useAppStore((s) => s.nudgeMatch);

  const alignedFrame = useMemo(
    () => alignedFaceFrame(frame, transform),
    [frame, transform],
  );
  const alignedRefs = useMemo(() => withoutAperture(refs), [refs]);

  const crop: Rect | null = useMemo(() => {
    if (!retracted || !transform || !smile || !refs?.mouthAperture) return null;

    const box = lipBoxFrom(refs.mouthAperture, smile);
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
      width: Math.min(w, retracted.width - x),
      height: Math.min(h, retracted.height - y),
    };
  }, [retracted, transform, smile, refs?.mouthAperture]);

  if (!retracted) return null;

  const view = crop ?? { x: 0, y: 0, width: retracted.width, height: retracted.height };
  const showsDesign = fit !== null && alignedFrame !== null && alignedRefs !== null;

  // One nudge step, scaled to the photo so it means the same thing on any
  // resolution: about a third of a millimetre at the mouth.
  const step = Math.max(1, Math.round(retracted.width / 500));

  return (
    <div className="reference">
      <span className="slider__name">
        Retracted view
        <em className="reference__hint">
          {showsDesign
            ? ' · this is the report’s “after”'
            : crop
              ? ' · reference only'
              : ' · unaligned, full photo'}
        </em>
      </span>

      <svg
        className="reference__svg"
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        preserveAspectRatio="xMidYMid meet"
        aria-label="Retracted photograph with the design"
      >
        <image
          href={retracted.url}
          x={0}
          y={0}
          width={retracted.width}
          height={retracted.height}
        />
        {showsDesign && (
          <ToothLayer
            fit={fit}
            frame={alignedFrame}
            refs={alignedRefs}
            palette={palette}
            opacity={0.85}
            // The aperture belongs to the smile photo, so masking here would
            // clip against the wrong mouth. The retractors expose the whole
            // arch anyway, which is the point of the view.
            masked={false}
            // The design is aligned to this photo, so this is the photo whose
            // light it should pick up.
            photo={{
              href: retracted.url,
              width: retracted.width,
              height: retracted.height,
            }}
            blend={photoBlend}
          />
        )}
      </svg>

      {/*
        The nudge signs are inverted on purpose. `nudgeMatch` shifts the
        transform that maps retracted -> smile, and the design is drawn through
        that transform's *inverse*, so a positive nudge moves the design the
        negative way on this view. The buttons are named for what the clinician
        sees happen, not for the sign they pass.
      */}
      {showsDesign && (
        <div className="reference__nudge">
          <span className="reference__nudgelabel">Nudge design</span>
          <button type="button" onClick={() => nudgeMatch(0, step)} title="Move the design up">↑</button>
          <button type="button" onClick={() => nudgeMatch(0, -step)} title="Move the design down">↓</button>
          <button type="button" onClick={() => nudgeMatch(step, 0)} title="Move the design left">←</button>
          <button type="button" onClick={() => nudgeMatch(-step, 0)} title="Move the design right">→</button>
        </div>
      )}
    </div>
  );
}
