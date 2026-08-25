import { useCallback, useRef } from 'react';
import type { FacialReferences } from '../../domain/faceFrame.js';
import { vec, type Vec2 } from '../../domain/geometry.js';

interface ReferenceOverlayProps {
  refs: FacialReferences;
  size: { width: number; height: number };
  onChange: (refs: FacialReferences) => void;
}

/**
 * The single-point handles: every reference field that is one `Vec2`.
 *
 * Derived structurally rather than by excluding field names, so adding another
 * polyline reference cannot silently break this.
 */
type PointKey = {
  [K in keyof FacialReferences]-?: FacialReferences[K] extends Vec2 ? K : never;
}[keyof FacialReferences];

const POINT_LABELS: Record<PointKey, string> = {
  leftPupil: 'Left pupil',
  rightPupil: 'Right pupil',
  leftAla: 'Left nasal wing',
  rightAla: 'Right nasal wing',
  midlineTop: 'Midline (top)',
  midlineBottom: 'Midline (bottom)',
};

/** What is currently being dragged. `null` when nothing is. */
type Drag = { kind: 'point'; key: PointKey } | { kind: 'lip'; index: number } | null;

/**
 * The reference lines and their drag handles (spec 5.1, 5.3).
 *
 * Handle size is derived from the image rather than fixed in pixels: the SVG
 * scales to fit the stage, so a constant radius would be invisible on a 4000px
 * photo and enormous on a small one.
 *
 * Dragging updates the references on every pointer move, not on release. The
 * spec is explicit that the arch should follow the handle live -- that
 * immediate feedback is what makes the tool feel intelligent (spec 5.4).
 */
export function ReferenceOverlay({ refs, size, onChange }: ReferenceOverlayProps) {
  const groupRef = useRef<SVGGElement>(null);
  const drag = useRef<Drag>(null);

  const unit = Math.max(size.width, size.height) / 130;

  /** Pointer position in the SVG's own user units. */
  const toLocal = useCallback((event: React.PointerEvent): Vec2 | null => {
    const svg = groupRef.current?.ownerSVGElement;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;

    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(ctm.inverse());
    return vec(local.x, local.y);
  }, []);

  const applyDrag = useCallback(
    (event: React.PointerEvent) => {
      const active = drag.current;
      if (!active) return;

      const position = toLocal(event);
      if (!position) return;

      if (active.kind === 'point') {
        onChange({ ...refs, [active.key]: position });
      } else {
        onChange({
          ...refs,
          lipCurve: refs.lipCurve.map((p, i) => (i === active.index ? position : p)),
        });
      }
    },
    [refs, onChange, toLocal],
  );

  const startDrag = (next: NonNullable<Drag>) => (event: React.PointerEvent) => {
    event.preventDefault();
    drag.current = next;
    event.currentTarget.setPointerCapture(event.pointerId);
    applyDrag(event);
  };

  const endDrag = (event: React.PointerEvent) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleProps = (active: NonNullable<Drag>) => ({
    onPointerDown: startDrag(active),
    onPointerMove: applyDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  });

  const lipPath = refs.lipCurve
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  return (
    <g ref={groupRef} className="overlay">
      {/* Interpupillary line: defines level, not the image edge. */}
      <line
        className="overlay__line"
        x1={refs.rightPupil.x}
        y1={refs.rightPupil.y}
        x2={refs.leftPupil.x}
        y2={refs.leftPupil.y}
        strokeWidth={unit * 0.18}
      />
      {/* Facial midline. */}
      <line
        className="overlay__line overlay__line--midline"
        x1={refs.midlineTop.x}
        y1={refs.midlineTop.y}
        x2={refs.midlineBottom.x}
        y2={refs.midlineBottom.y}
        strokeWidth={unit * 0.18}
      />
      {/* Inter-alar width: the scale reference. */}
      <line
        className="overlay__line overlay__line--alar"
        x1={refs.rightAla.x}
        y1={refs.rightAla.y}
        x2={refs.leftAla.x}
        y2={refs.leftAla.y}
        strokeWidth={unit * 0.18}
      />
      {/* The smile curve the incisal edges are laid against. */}
      <path className="overlay__curve" d={lipPath} strokeWidth={unit * 0.18} />

      {refs.lipCurve.map((p, i) => (
        <circle
          key={`lip-${i}`}
          className="overlay__handle overlay__handle--lip"
          cx={p.x}
          cy={p.y}
          r={unit * 0.45}
          {...handleProps({ kind: 'lip', index: i })}
        >
          <title>Lip line point {i + 1}</title>
        </circle>
      ))}

      {(Object.keys(POINT_LABELS) as PointKey[]).map((key) => (
        <circle
          key={key}
          className="overlay__handle"
          cx={refs[key].x}
          cy={refs[key].y}
          r={unit * 0.7}
          {...handleProps({ kind: 'point', key })}
        >
          <title>{POINT_LABELS[key]}</title>
        </circle>
      ))}
    </g>
  );
}
