import { PARAM_LIMITS, useAppStore, type FineTuneParams } from '../../state/store.js';

/**
 * The fine-tune parameters -- the dominant interaction in the design step.
 *
 * Dragging updates the design live so the arch follows the slider; the store
 * commits one undo entry per drag, on release, rather than one per value
 * change.
 */

const LABELS: Record<keyof FineTuneParams, { name: string; hint: string }> = {
  ratio: {
    name: 'Ratio',
    hint: 'Width to length. Lower is longer and narrower.',
  },
  scale: {
    name: 'Scale',
    hint: 'Overall size of the arch against the face.',
  },
  smileCurve: {
    name: 'Smile curve',
    hint: 'Arc of the incisal edges. It should follow the lower lip; flat or reversed reads as artificial.',
  },
  occlusalGap: {
    name: 'Occlusal gap',
    hint: 'How far the arch sits up or down against the lip line.',
  },
  redProportion: {
    name: 'Tooth proportion',
    // True for both kinds of template (see fitting.ts). The built-in ones draw
    // the lateral at this share and the canine at its square; an imported one
    // scales its own lateral onto this share and its canine by the square of
    // the change -- held at the lateral's width if it would outgrow it, which
    // is why the hint promises only that the canine moves with it.
    hint: "Width of the upper lateral as a share of the central's. The canine narrows and widens with it.",
  },
  archWidth: {
    name: 'Arch width',
    hint: 'Fills or opens the dark corridors at the corners of the smile.',
  },
};

/**
 * Ordered by how a clinician works: size the arch, set its proportions, place
 * it against the lip, then shape the corners.
 */
const ORDER: (keyof FineTuneParams)[] = [
  'scale',
  'ratio',
  'redProportion',
  'smileCurve',
  'occlusalGap',
  'archWidth',
];

export function ParamSliders() {
  const params = useAppStore((s) => s.design.params);
  const setParams = useAppStore((s) => s.setParams);
  const beginParamDrag = useAppStore((s) => s.beginParamDrag);
  const endParamDrag = useAppStore((s) => s.endParamDrag);
  const resetParams = useAppStore((s) => s.resetParams);

  return (
    <div className="sliders">
      <div className="sliders__header">
        <h2 className="step__heading">Fine tune</h2>
        <button type="button" className="sliders__reset" onClick={resetParams}>
          Reset
        </button>
      </div>

      {ORDER.map((key) => {
        const limits = PARAM_LIMITS[key];
        const value = params[key];
        return (
          <label key={key} className="slider">
            <span className="slider__name">{LABELS[key].name}</span>
            <input
              type="range"
              min={limits.min}
              max={limits.max}
              step={limits.step}
              value={value}
              onPointerDown={beginParamDrag}
              onPointerUp={endParamDrag}
              onKeyDown={beginParamDrag}
              onKeyUp={endParamDrag}
              onChange={(event) =>
                setParams({ [key]: Number(event.target.value) })
              }
            />
            <output className="slider__value">{format(key, value)}</output>
            <span className="slider__hint">
              {LABELS[key].hint}
              {CLINICAL_MARKS[key] && (
                <em className="slider__clinical">{CLINICAL_MARKS[key]}</em>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** Match each slider's displayed precision to its step size. */
function format(key: keyof FineTuneParams, value: number): string {
  const step = PARAM_LIMITS[key].step;
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return value.toFixed(decimals);
}

/**
 * Published clinical targets, shown under the tracks that have them.
 *
 * These are the numbers a clinician is aiming at, so putting them on the
 * control saves recalling them -- and makes it obvious when a design has
 * drifted outside the accepted band.
 */
const CLINICAL_MARKS: Partial<Record<keyof FineTuneParams, string>> = {
  ratio: 'target 0.80 · accepted 0.70-0.90',
  redProportion: '0.62 golden · 0.70 normal · 0.80 short face',
};
