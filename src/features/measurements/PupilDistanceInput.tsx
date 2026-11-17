import { useEffect, useId, useState } from 'react';
import { useAppStore } from '../../state/store.js';
import { parsePupilDistance } from '../../domain/measurements.js';

/**
 * The patient's pupil distance, that sizes in mm are worked out from. Shown
 * in the Design step, above the measurements.
 *
 * The field keeps what was typed, so "62,5" stays as typed. A usable value
 * goes to the store as it is typed; anything else -- empty, out of range, not
 * a number -- leaves the store with none, so no size is ever shown from a
 * number the field no longer says. Why a value cannot be used is shown once
 * the field is left, not at every keystroke on the way to a good one.
 */
export function PupilDistanceInput() {
  const stored = useAppStore((s) => s.pupilDistanceMm);
  const setPupilDistance = useAppStore((s) => s.setPupilDistance);

  const [text, setText] = useState(() => (stored === null ? '' : String(stored)));
  const [showProblem, setShowProblem] = useState(false);
  const id = useId();

  const parsed = parsePupilDistance(text);
  const typed = parsed.ok ? parsed.value : null;

  // A value changed from elsewhere -- a case opened, New case -- replaces
  // what is typed. Typing itself never gets here: it keeps the two equal, or
  // leaves the store empty while the text cannot be used.
  // Keyed on the store alone: `typed` follows the text, and only a change in
  // the store is news.
  useEffect(() => {
    if (stored !== typed) {
      setText(stored === null ? '' : String(stored));
      setShowProblem(false);
    }
  }, [stored]);

  const change = (value: string) => {
    setText(value);
    const next = parsePupilDistance(value);
    setPupilDistance(next.ok ? next.value : null);
    if (next.ok) setShowProblem(false);
  };

  const problem = showProblem && !parsed.ok ? parsed.reason : null;

  return (
    <div className="pupil-distance">
      <label className="pupil-distance__label" htmlFor={`${id}-input`}>
        Pupil distance
      </label>
      <span className="pupil-distance__field">
        <input
          id={`${id}-input`}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="e.g. 62"
          value={text}
          onChange={(event) => change(event.target.value)}
          onBlur={() => setShowProblem(true)}
          aria-invalid={problem !== null}
          aria-describedby={`${id}-hint`}
        />
        <span aria-hidden="true">mm</span>
      </span>
      <p id={`${id}-hint`} className={problem ? 'pupil-distance__problem' : 'pupil-distance__hint'}>
        {problem ?? "The patient's, measured. Sizes in mm are worked out from it."}
      </p>
    </div>
  );
}
