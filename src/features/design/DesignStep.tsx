import { useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../../state/store.js';
import { orientedSize } from '../../domain/imageOrientation.js';
import { fitArches } from '../../domain/fitting.js';
import { getTemplate } from '../../domain/templates/buildTemplate.js';
import { sampleToothColor } from '../../vision/sampleToothColor.js';
import { decodeForDetection } from '../../vision/faceLandmarker.js';
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
  const refs = useAppStore((s) => s.face.refs);
  const selectedTeeth = useAppStore((s) => s.selectedTeeth);
  const templateId = useAppStore((s) => s.design.templateId);
  const params = useAppStore((s) => s.design.params);
  const teethOpacity = useAppStore((s) => s.design.teethOpacity);
  const setTeethOpacity = useAppStore((s) => s.setTeethOpacity);
  const lipMask = useAppStore((s) => s.design.lipMask);
  const setLipMask = useAppStore((s) => s.setLipMask);
  const palette = useAppStore((s) => s.design.palette);
  const paletteSampled = useAppStore((s) => s.design.paletteSampled);
  const setPalette = useAppStore((s) => s.setPalette);

  const template = templateId ? getTemplate(templateId) : undefined;

  /*
   * Sample the patient's enamel colour once per photo, so the design sits
   * against their own lighting and skin tone rather than a generic white.
   * Keyed on the photo URL and re-run if the aperture changes, but never on
   * every render -- decoding and reading pixels is not free.
   */
  const sampledFor = useRef<string | null>(null);
  const photoUrl = photo?.url ?? null;
  const aperture = refs?.mouthAperture;

  useEffect(() => {
    if (!photoUrl || !aperture || aperture.length < 3) return;
    if (sampledFor.current === photoUrl) return;
    sampledFor.current = photoUrl;

    let cancelled = false;
    void (async () => {
      try {
        const image = await decodeForDetection(photoUrl);
        if (cancelled) return;
        setPalette(sampleToothColor(image, aperture));
      } catch {
        // Sampling is a nicety; the default palette is a fine fallback.
        if (!cancelled) setPalette(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [photoUrl, aperture, setPalette]);

  const fit = useMemo(
    () => (template ? fitArches(selectedTeeth, template, params) : null),
    [template, selectedTeeth, params],
  );

  if (!photo || !frame || !refs) {
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
            {fit && (
              <ToothLayer
                fit={fit}
                frame={frame}
                refs={refs}
                opacity={teethOpacity}
                masked={lipMask}
                palette={palette}
              />
            )}
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

          {/*
            The mask is what puts the design inside the mouth. Turning it off
            shows the whole arch, which is how you check the fit behind the
            lips rather than only the part that shows.
          */}
          <label className="toggle">
            <input
              type="checkbox"
              checked={lipMask}
              onChange={(event) => setLipMask(event.target.checked)}
            />
            <span>Clip teeth to the mouth</span>
          </label>

          {/*
            Sampled colour is an approximation -- camera, lighting and display
            all shift it -- so it is labelled as one and never presented as a
            shade match.
          */}
          <div className="palette">
            <span className="slider__name">Tooth colour</span>
            <span className="palette__swatches" aria-hidden="true">
              <i style={{ background: palette.cervical }} />
              <i style={{ background: palette.base }} />
              <i style={{ background: palette.highlight }} />
              <i style={{ background: palette.incisal }} />
            </span>
            <span className="slider__hint">
              {paletteSampled
                ? 'Approximated from this photo. Not a shade match.'
                : 'Default enamel — no usable sample from this photo.'}
            </span>
          </div>

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
