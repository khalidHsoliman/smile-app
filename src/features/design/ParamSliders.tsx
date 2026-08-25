import { PARAM_LIMITS, useAppStore, type FineTuneParams } from '../../state/store.js';

/**
 * The five fine-tune parameters (spec 6.4) -- the dominant interaction in the
 * previous product, reproduced with its validated ranges and step sizes.
 *
 * Dragging updates the design live so the arch follows the slider; the store
 * commits one undo entry per drag, on release, rather than one per value
 * change (spec 9.3).
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
  curveOfSpee: {
    name: 'Curve of Spee',
    hint: 'Curvature of the incisal edge. Negative flattens or reverses it.',
  },
  occlusalGap: {
    name: 'Occlusal gap',
    hint: 'How far the arch sits up or down against the lip line.',
  },
  innerGap: {
    name: 'Inner gap',
    hint: 'Spacing between neighbouring teeth. Negative overlaps them.',
  },
};

const ORDER: (keyof FineTuneParams)[] = [
  'scale',
  'ratio',
  'curveOfSpee',
  'occlusalGap',
  'innerGap',
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
            <span className="slider__hint">{LABELS[key].hint}</span>
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
