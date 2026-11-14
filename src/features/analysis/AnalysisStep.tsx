import { useCallback, useEffect, useRef, useState } from 'react';
import { useZoom } from '../view/useZoom.js';
import { ZoomControls } from '../view/ZoomControls.js';
import { vec } from '../../domain/geometry.js';
import { useAppStore } from '../../state/store.js';
import { deriveReferences } from '../../domain/deriveReferences.js';
import type { FacialReferences } from '../../domain/faceFrame.js';
import { decodeForDetection, detectLandmarks } from '../../vision/faceLandmarker.js';
import { verifyReferences } from '../../vision/verifyIndices.js';
import { ReferenceOverlay } from './ReferenceOverlay.js';

type Status = 'idle' | 'detecting' | 'ready' | 'failed';

/**
 * Facial analysis: auto-detect the references, then let the clinician
 * correct them. Detection only seeds the handles -- the midline in particular
 * is a matter of professional judgment, so it is always adjustable.
 */
export function AnalysisStep() {
  const photo = useAppStore((s) => s.photos.smile);
  const refs = useAppStore((s) => s.face.refs);
  const frameError = useAppStore((s) => s.face.error);
  const setFacialReferences = useAppStore((s) => s.setFacialReferences);

  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  /** Anatomy check on the detected references -- see vision/verifyIndices. */
  const [warnings, setWarnings] = useState<string[]>([]);

  // Guards against a detection landing after the photo it ran on was replaced.
  const runId = useRef(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoom = useZoom(svgRef);

  const size = photo;   // already oriented: rotation is baked in

  const detect = useCallback(async () => {
    if (!photo || !size) return;

    const id = ++runId.current;
    setStatus('detecting');
    setMessage(null);

    try {
      const image = await decodeForDetection(photo.url);
      const landmarks = await detectLandmarks(image);
      if (id !== runId.current) return; // superseded

      const derived = deriveReferences(landmarks, size);

      // If the model version has moved the indices we depend on, this is where
      // it surfaces -- loudly, rather than as a subtly misplaced arch.
      const check = verifyReferences(derived);
      setWarnings(check.problems);
      if (!check.ok) {
        console.warn('Landmark index check failed:', check.problems);
      }

      setFacialReferences(derived);
      setStatus('ready');
    } catch (cause) {
      if (id !== runId.current) return;
      setStatus('failed');
      setWarnings([]);
      setMessage((cause as Error).message);
    }
  }, [photo, size?.width, size?.height, setFacialReferences]);

  // Detect once per photo. Re-running on every render would thrash the WASM
  // runtime; the button covers a deliberate retry.
  useEffect(() => {
    if (photo && !refs && status === 'idle') void detect();
  }, [photo, refs, status, detect]);

  if (!photo || !size) {
    return <p className="placeholder">Upload a smile photo first.</p>;
  }

  return (
    <div className="step step--analysis">
      <div className="analysis__bar">
        <button type="button" onClick={() => void detect()} disabled={status === 'detecting'}>
          {status === 'detecting' ? 'Detecting…' : 'Re-detect'}
        </button>
        {status === 'detecting' && <span className="analysis__hint">Loading the face model…</span>}
        {message && <span className="analysis__error">{message}</span>}
        {frameError && <span className="analysis__error">{frameError}</span>}
        {refs && !frameError && warnings.length === 0 && (
          <span className="analysis__hint">Drag any handle to correct it.</span>
        )}
      </div>

      {warnings.length > 0 && (
        <p className="analysis__warning">
          The detected landmarks look anatomically wrong ({warnings.join('; ')}). The
          MediaPipe indices in <code>vision/landmarkIndices.ts</code> may need updating
          for this model version. Correct the handles by hand for now.
        </p>
      )}

      <div className="analysis__stage">
        <svg
          ref={svgRef}
          className="analysis__svg"
          viewBox={`0 0 ${size.width} ${size.height}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={(e) => void zoom.onPanDown(e)}
          onPointerMove={(e) => void zoom.onPanMove(e)}
          onPointerUp={(e) => void zoom.onPanUp(e)}
        >
          {/* One transform for the photo and every overlay. */}
          <g transform={zoom.groupTransform}>
            <image
              href={photo.url}
              x={0}
              y={0}
              width={size.width}
              height={size.height}
            />
            {refs && (
              <ReferenceOverlay
                refs={refs}
                size={size}
                onChange={(next: FacialReferences) => setFacialReferences(next)}
              />
            )}
          </g>
        </svg>
        <ZoomControls centre={vec(size.width / 2, size.height / 2)} />
      </div>
    </div>
  );
}

