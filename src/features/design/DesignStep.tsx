import { useMemo } from 'react';
import { useAppStore } from '../../state/store.js';
import { orientedSize } from '../../domain/imageOrientation.js';
import { fitArches } from '../../domain/fitting.js';
import { getTemplate } from '../../domain/templates/buildTemplate.js';
import { TemplatePicker } from './TemplatePicker.js';
import { ParamSliders } from './ParamSliders.js';
import { ToothLayer } from './ToothLayer.js';

/**
 * The design step (spec 6): the arch fitted onto the photo, with the five
 * fine-tune sliders.
 *
 * The fit is **derived**, recomputed from frame + template + params on every
 * render rather than stored (spec 9.1). It is cheap -- a couple of dozen teeth
 * of arithmetic -- and keeping it derived removes any chance of the design and
 * its inputs drifting apart.
 */
export function DesignStep() {
  const photo = useAppStore((s) => s.photos.smile);
  const frame = useAppStore((s) => s.face.frame);
  const selectedTeeth = useAppStore((s) => s.selectedTeeth);
  const templateId = useAppStore((s) => s.design.templateId);
  const params = useAppStore((s) => s.design.params);
  const teethOpacity = useAppStore((s) => s.design.teethOpacity);
  const setTeethOpacity = useAppStore((s) => s.setTeethOpacity);

  const template = templateId ? getTemplate(templateId) : undefined;

  const fit = useMemo(
    () => (template ? fitArches(selectedTeeth, template, params) : null),
    [template, selectedTeeth, params],
  );

  if (!photo || !frame) {
    return <p className="placeholder">Complete the facial analysis first.</p>;
  }

  const size = orientedSize(photo, photo.rotation);

  return (
    <div className="step step--design">
      <div className="design">
        <div className="design__stage">
          <svg
            className="design__svg"
            viewBox={`0 0 ${size.width} ${size.height}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <image
              href={photo.url}
              x={0}
              y={0}
              width={size.width}
              height={size.height}
              transform={photoTransform(photo.rotation, size)}
            />
            {fit && <ToothLayer fit={fit} frame={frame} opacity={teethOpacity} />}
          </svg>
        </div>

        <aside className="design__panel">
          {/*
            Teeth opacity is a first-class, always-visible control, not a buried
            one: toggling it to compare against the original was the previous
            product's most-used control (spec 7.1).
          */}
          <label className="opacity">
            <span className="slider__name">Teeth opacity</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={teethOpacity}
              onChange={(event) => setTeethOpacity(Number(event.target.value))}
            />
            <output className="slider__value">
              {Math.round(teethOpacity * 100)}%
            </output>
          </label>

          <ParamSliders />

          <h2 className="step__heading">Template</h2>
          <TemplatePicker />
        </aside>
      </div>
    </div>
  );
}

/** Rotation is stored, not baked into the pixels -- see AnalysisStep. */
function photoTransform(rotation: number, size: { width: number; height: number }): string {
  if (rotation === 0) return '';
  return `rotate(${rotation * 90} ${size.width / 2} ${size.height / 2})`;
}
