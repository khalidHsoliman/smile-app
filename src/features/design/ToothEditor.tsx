import { toFDI } from '../../domain/teeth.js';
import { vec } from '../../domain/geometry.js';
import type { ToothEdit } from '../../domain/toothEdits.js';
import { useAppStore } from '../../state/store.js';

/**
 * Per-tooth refinement.
 *
 * Nudge buttons rather than free dragging. Dragging a tooth on a photograph
 * sounds more direct but is worse in practice: the adjustments that matter here
 * are fractions of a millimetre, a pointer drag cannot resolve them reliably,
 * and every drag risks disturbing a placement the clinician was happy with.
 * Discrete steps are repeatable, and they say out loud how much each press
 * moves the tooth.
 *
 * Everything here produces a *delta* on the computed fit, never a replacement
 * -- so a global slider change afterwards keeps the manual work.
 */

/** One press, in face-frame units. About a tenth of a central incisor width. */
const STEP = {
  move: 0.012,
  rotate: (1.5 * Math.PI) / 180,
  scale: 1.03,
} as const;

export function ToothEditor() {
  const selection = useAppStore((s) => s.design.selection);
  const edits = useAppStore((s) => s.design.edits);
  const mirrorMode = useAppStore((s) => s.design.mirrorMode);
  const nudge = useAppStore((s) => s.nudgeSelection);
  const reset = useAppStore((s) => s.resetSelection);
  const setMirrorMode = useAppStore((s) => s.setMirrorMode);
  const setSelection = useAppStore((s) => s.setToothSelection);

  const has = selection.length > 0;
  const edited = selection.filter((t) => edits[t] !== undefined);

  const apply = (delta: Partial<ToothEdit>) =>
    nudge({
      offset: delta.offset ?? vec(0, 0),
      rotation: delta.rotation ?? 0,
      scaleX: delta.scaleX ?? 1,
      scaleY: delta.scaleY ?? 1,
    });

  return (
    <div className="editor">
      <div className="editor__header">
        <h2 className="step__heading">Individual teeth</h2>
        {has && (
          <button type="button" className="sliders__reset" onClick={() => setSelection([])}>
            Deselect
          </button>
        )}
      </div>

      {!has ? (
        <p className="editor__empty">
          Click a tooth on the photo to adjust it on its own.
        </p>
      ) : (
        <>
          <p className="editor__selection">
            {selection.map(toFDI).join(', ')}
            {edited.length > 0 && <em> · {edited.length} adjusted</em>}
          </p>

          <div className="editor__pad">
            <Nudge label="↑" title="Move up" onClick={() => apply({ offset: vec(0, -STEP.move) })} />
            <Nudge label="↓" title="Move down" onClick={() => apply({ offset: vec(0, STEP.move) })} />
            <Nudge label="←" title="Move left" onClick={() => apply({ offset: vec(-STEP.move, 0) })} />
            <Nudge label="→" title="Move right" onClick={() => apply({ offset: vec(STEP.move, 0) })} />
            <Nudge label="⟲" title="Rotate left" onClick={() => apply({ rotation: -STEP.rotate })} />
            <Nudge label="⟳" title="Rotate right" onClick={() => apply({ rotation: STEP.rotate })} />
          </div>

          <div className="editor__pad">
            <Nudge label="Wider" onClick={() => apply({ scaleX: STEP.scale })} />
            <Nudge label="Narrower" onClick={() => apply({ scaleX: 1 / STEP.scale })} />
            <Nudge label="Longer" onClick={() => apply({ scaleY: STEP.scale })} />
            <Nudge label="Shorter" onClick={() => apply({ scaleY: 1 / STEP.scale })} />
          </div>

          <label className="toggle">
            <input
              type="checkbox"
              checked={mirrorMode}
              onChange={(e) => setMirrorMode(e.target.checked)}
            />
            <span>Mirror to the matching tooth</span>
          </label>

          <button
            type="button"
            className="sliders__reset editor__reset"
            onClick={reset}
            disabled={edited.length === 0}
          >
            Reset {edited.length > 1 ? `${edited.length} teeth` : 'tooth'}
          </button>
        </>
      )}
    </div>
  );
}

function Nudge({
  label,
  title,
  onClick,
}: {
  label: string;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="editor__nudge" title={title ?? label} onClick={onClick}>
      {label}
    </button>
  );
}
