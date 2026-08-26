import { useAppStore } from '../../state/store.js';
import { IDENTITY, zoomAbout, type Vec2 } from '../../domain/geometry.js';

/**
 * On-stage zoom buttons.
 *
 * The wheel and middle-drag do the real work; these exist so the capability is
 * discoverable without being guessed at, and they show the current zoom so a
 * clinician knows they are not looking at the photo 1:1.
 */
export function ZoomControls({ centre }: { centre: Vec2 }) {
  const transform = useAppStore((s) => s.view.transform);
  const setViewTransform = useAppStore((s) => s.setViewTransform);

  const zoom = (factor: number) =>
    setViewTransform(zoomAbout(transform, centre, factor));

  return (
    <div className="zoom no-print">
      <button type="button" onClick={() => zoom(1.25)} title="Zoom in (wheel)">
        +
      </button>
      <button type="button" onClick={() => zoom(1 / 1.25)} title="Zoom out">
        −
      </button>
      <button
        type="button"
        onClick={() => setViewTransform(IDENTITY)}
        disabled={transform.a === 1}
        title="Fit to view"
      >
        ⛶
      </button>
      {transform.a !== 1 && (
        <span className="zoom__level">{Math.round(transform.a * 100)}%</span>
      )}
    </div>
  );
}
