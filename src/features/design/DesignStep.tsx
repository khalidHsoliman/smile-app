import { useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../../state/store.js';
import { fitArches } from '../../domain/fitting.js';
import { applyEdits } from '../../domain/toothEdits.js';
import { getTemplate } from '../../domain/templates/buildTemplate.js';
import { sampleToothColor } from '../../vision/sampleToothColor.js';
import { decodeForDetection } from '../../vision/faceLandmarker.js';
import { TemplatePicker } from './TemplatePicker.js';
import { ParamSliders } from './ParamSliders.js';
import { ToothEditor } from './ToothEditor.js';
import { ShadePicker } from './ShadePicker.js';
import { RetractedReference } from './RetractedReference.js';
import { useZoom } from '../view/useZoom.js';
import { ZoomControls } from '../view/ZoomControls.js';
import { vec } from '../../domain/geometry.js';
import { UndoControls } from './UndoControls.js';
import { ToothLayer } from './ToothLayer.js';
import { Measurements } from '../measurements/Measurements.js';
import { PupilDistanceInput } from '../measurements/PupilDistanceInput.js';

/**
 * The design step: the arch fitted onto the photo, with the five
 * fine-tune sliders.
 *
 * The fit is **derived**, recomputed from frame + template + params on every
 * render rather than stored. It is cheap -- a couple of dozen teeth
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
  const photoBlend = useAppStore((s) => s.design.photoBlend);
  const setLipMask = useAppStore((s) => s.setLipMask);
  const setPhotoBlend = useAppStore((s) => s.setPhotoBlend);
  const palette = useAppStore((s) => s.design.palette);
  const paletteSampled = useAppStore((s) => s.design.paletteSampled);
  const edits = useAppStore((s) => s.design.edits);
  const selection = useAppStore((s) => s.design.selection);
  const toggleToothSelection = useAppStore((s) => s.toggleToothSelection);
  const setToothSelection = useAppStore((s) => s.setToothSelection);
  const setPalette = useAppStore((s) => s.setPalette);
  const pupilDistanceMm = useAppStore((s) => s.pupilDistanceMm);

  const template = templateId ? getTemplate(templateId) : undefined;

  /*
   * Sample the patient's enamel colour once per photo, so the design sits
   * against their own lighting and skin tone rather than a generic white.
   * Keyed on the photo URL and re-run if the aperture changes, but never on
   * every render -- decoding and reading pixels is not free.
   */
  const sampledFor = useRef<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoom = useZoom(svgRef);
  const photoUrl = photo?.url ?? null;
  const aperture = refs?.mouthAperture;

  useEffect(() => {
    if (!photoUrl || !aperture || aperture.length < 3) return;
    if (sampledFor.current === photoUrl) return;
    /*
     * Never overwrite a shade the clinician chose by hand. Object URLs are
     * recreated on every restore, so without this a reload re-sampled the
     * photo and silently replaced a deliberate choice -- while the panel went
     * on claiming the colour came from the photograph.
     */
    if (paletteSampled) return;
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
  }, [photoUrl, aperture, paletteSampled, setPalette]);

  /*
   * The fit, then the manual deltas on top of it. Two steps, not
   * one: the fit never sees the edits, so a slider change recomputes cleanly
   * and the deltas reapply to the new placement instead of being destroyed.
   */
  const fit = useMemo(() => {
    if (!template) return null;
    const fitted = fitArches(selectedTeeth, template, params);
    return { ...fitted, teeth: applyEdits(fitted.teeth, edits) };
  }, [template, selectedTeeth, params, edits]);

  if (!photo || !frame || !refs) {
    return <p className="placeholder">Complete the facial analysis first.</p>;
  }

  const size = photo;   // already oriented: rotation is baked in

  return (
    <div className="step step--design">
      <div className="design">
        <div className="design__left">
        <div className="design__stage">
          <svg
            ref={svgRef}
            className="design__svg"
            viewBox={`0 0 ${size.width} ${size.height}`}
            preserveAspectRatio="xMidYMid meet"
            onPointerDown={(e) => void zoom.onPanDown(e)}
            onPointerMove={(e) => void zoom.onPanMove(e)}
            onPointerUp={(e) => void zoom.onPanUp(e)}
          >
            {/*
              Clicking away from a tooth clears the selection. Outside the zoom
              group on purpose -- it must cover the viewport at any zoom -- and
              left-button only, so a middle-drag pan does not deselect.
            */}
            <rect
              x={0}
              y={0}
              width={size.width}
              height={size.height}
              fill="transparent"
              onPointerDown={(e) => {
                if (e.button === 0) setToothSelection([]);
              }}
            />
            {/* One transform for the photo and every overlay. */}
            <g transform={zoom.groupTransform}>
              <image
                href={photo.url}
                x={0}
                y={0}
                width={size.width}
                height={size.height}
              />
              {fit && (
                <ToothLayer
                  fit={fit}
                  frame={frame}
                  refs={refs}
                  opacity={teethOpacity}
                  masked={lipMask}
                  palette={palette}
                  photo={{ href: photo.url, width: size.width, height: size.height }}
                  blend={photoBlend}
                  selection={selection}
                  onToothClick={toggleToothSelection}
                />
              )}
            </g>
          </svg>
          <ZoomControls centre={vec(size.width / 2, size.height / 2)} />
        </div>

        {/*
          The anatomical truth beside the design: the clinician glances at the
          patient's real teeth while shaping the new ones, instead of meeting
          them again only in the report.
        */}
        <RetractedReference fit={fit} />
        </div>

        <aside className="design__panel">
          <UndoControls />

          {/*
            Teeth opacity is a first-class, always-visible control, not a buried
            one: toggling it to compare against the original is the most-used
            control.
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
            Blending carries the photograph's light onto the design. Off shows
            the drawn colour on its own, which is how you judge the shade
            itself -- the blend deliberately darkens it wherever the photo is
            in shadow.
          */}
          <label className="toggle">
            <input
              type="checkbox"
              checked={photoBlend}
              onChange={(event) => setPhotoBlend(event.target.checked)}
            />
            <span>Blend into the photo</span>
          </label>

          <ShadePicker />

          <ParamSliders />

          <PupilDistanceInput />

          <Measurements
            refs={refs}
            teeth={fit?.teeth ?? null}
            template={template}
            pupilDistanceMm={pupilDistanceMm}
            where="panel"
          />

          <ToothEditor />

          <h2 className="step__heading">Template</h2>
          <TemplatePicker />
        </aside>
      </div>
    </div>
  );
}

