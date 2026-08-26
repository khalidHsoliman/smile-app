import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../state/store.js';
import { orientedSize } from '../../domain/imageOrientation.js';
import { isPlausibleScale } from '../../domain/autoMatch.js';
import { robustPairs, scaleOf } from '../../domain/similarity.js';
import { buildMatchPairs } from '../../vision/matchPairs.js';
import { toSvgMatrix, vec, type Vec2 } from '../../domain/geometry.js';
import { decodeForDetection, detectLandmarks } from '../../vision/faceLandmarker.js';

type Status = 'idle' | 'detecting' | 'auto' | 'failed';

/**
 * Photo matching (spec 15).
 *
 * Aligns the retracted photograph onto the smile photograph so the design can
 * be shown on both and the report carries a genuine second before/after pair.
 *
 * The spec's shape: automatic alignment first, then manual correction by
 * placing corresponding points, then a fine-tuning overlay at partial opacity.
 * Auto-detection usually settles it, so the manual path is there for when the
 * detector cannot find a face behind the retractors.
 */
export function MatchingStep() {
  const photos = useAppStore((s) => s.photos);
  const matching = useAppStore((s) => s.matching);
  const setMatchPairs = useAppStore((s) => s.setMatchPairs);
  const confirmMatch = useAppStore((s) => s.confirmMatch);
  const nudgeMatch = useAppStore((s) => s.nudgeMatch);
  const skipMatch = useAppStore((s) => s.skipMatch);

  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(0.55);
  /** The half of a pair placed first, waiting for its partner. */
  const [pending, setPending] = useState<Vec2 | null>(null);

  const attempted = useRef(false);
  /** Drag-in-progress on the overlay: distinguishes a nudge from a click. */
  const dragState = useRef<{ last: Vec2; startX: number; startY: number; moved: boolean } | null>(null);

  const smile = photos.smile;
  const retracted = photos.retracted;
  const smileSize = smile ? orientedSize(smile, smile.rotation) : null;
  const retractedSize = retracted ? orientedSize(retracted, retracted.rotation) : null;

  /**
   * Seed the alignment from both photos' landmarks.
   *
   * Both photos go through the same face model, so index-for-index the two
   * results are the same mesh vertices -- a dense set of correspondences with
   * no clicking, restricted to the rigid upper face (the retractors deform
   * everything below the nose). The outliers a detector inevitably produces
   * are trimmed against the consensus before the pairs are adopted.
   */
  const autoAlign = useCallback(async () => {
    if (!smile || !retracted || !smileSize || !retractedSize) return;

    setStatus('detecting');
    setMessage(null);

    try {
      const [smileImage, retractedImage] = await Promise.all([
        decodeForDetection(smile.url),
        decodeForDetection(retracted.url),
      ]);

      const smileLandmarks = await detectLandmarks(smileImage);
      const retractedLandmarks = await detectLandmarks(retractedImage);

      const raw = buildMatchPairs(
        retractedLandmarks,
        smileLandmarks,
        retractedSize,
        smileSize,
      );
      const { kept, dropped } = robustPairs(raw);
      if (dropped > 0) {
        setMessage(`${dropped} unreliable point${dropped > 1 ? 's' : ''} discarded.`);
      }
      setMatchPairs(kept);
      setStatus('auto');
    } catch (cause) {
      setStatus('failed');
      setMessage(
        `${(cause as Error).message} Place matching points by hand instead.`,
      );
    }
  }, [smile, retracted, smileSize, retractedSize, setMatchPairs]);

  useEffect(() => {
    if (!attempted.current && smile && retracted) {
      attempted.current = true;
      void autoAlign();
    }
  }, [smile, retracted, autoAlign]);

  if (!smile || !retracted || !smileSize || !retractedSize) {
    return (
      <div className="step step--matching">
        <p className="placeholder">
          Matching needs both photos. Skip it to design on the smile photo alone.
        </p>
        <button type="button" className="matching__primary" onClick={skipMatch}>
          Skip matching
        </button>
      </div>
    );
  }

  /** Click a feature on the retracted photo, then the same one on the smile photo. */
  const clickRetracted = (point: Vec2) => setPending(point);
  const clickSmile = (point: Vec2) => {
    if (!pending) return;
    setMatchPairs([...matching.pairs, { source: pending, target: point }]);
    setPending(null);
  };

  const scale = matching.transform ? scaleOf(matching.transform) : null;
  const implausible = scale !== null && !isPlausibleScale(scale);

  return (
    <div className="step step--matching">
      <div className="matching__bar">
        <button type="button" onClick={() => void autoAlign()} disabled={status === 'detecting'}>
          {status === 'detecting' ? 'Detecting…' : 'Auto-align'}
        </button>
        <button
          type="button"
          onClick={() => setMatchPairs([])}
          disabled={matching.pairs.length === 0}
        >
          Clear points
        </button>

        <label className="matching__opacity">
          Overlay
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
          />
        </label>

        {matching.transform && (
          <span className="matching__hint">Drag the overlay until the teeth line up.</span>
        )}
        <span className="matching__status">
          {matching.pairs.length} point{matching.pairs.length === 1 ? '' : 's'}
          {matching.transform && ` · ${matching.error.toFixed(1)}px error`}
        </span>

        {message && <span className="matching__error">{message}</span>}
        {implausible && (
          <span className="matching__error">
            The alignment looks wrong ({scale?.toFixed(2)}× scale). Check the points.
          </span>
        )}
      </div>

      {/*
        The overlay: the retracted photo transformed onto the smile photo at
        partial opacity -- the spec's fine-tuning view (stage 3). Dragging it
        nudges the alignment, which is the correction for what a similarity fit
        cannot model: head pitch between the two shots moves the mouth relative
        to the eyes, and only a human can say where the teeth should sit.
        A plain click still completes a pair started on the photo below.
      */}
      <div className="matching__stage">
        <svg
          className="matching__svg"
          viewBox={`0 0 ${smileSize.width} ${smileSize.height}`}
          onPointerDown={(event) => {
            dragState.current = {
              last: localPoint(event),
              startX: event.clientX,
              startY: event.clientY,
              moved: false,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = dragState.current;
            if (!drag || event.buttons === 0) return;
            // A few screen pixels of slack keeps an intended click from
            // registering as a micro-drag.
            if (!drag.moved) {
              if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
              drag.moved = true;
            }
            const point = localPoint(event);
            if (matching.transform) nudgeMatch(point.x - drag.last.x, point.y - drag.last.y);
            drag.last = point;
          }}
          onPointerUp={(event) => {
            const drag = dragState.current;
            dragState.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            // No movement means it was a click: complete a pending point pair.
            if (drag && !drag.moved) clickSmile(localPoint(event));
          }}
        >
          <image href={smile.url} x={0} y={0} width={smileSize.width} height={smileSize.height} />
          {matching.transform && (
            <image
              href={retracted.url}
              x={0}
              y={0}
              width={retractedSize.width}
              height={retractedSize.height}
              opacity={opacity}
              transform={toSvgMatrix(matching.transform)}
            />
          )}
          {matching.pairs.map((pair, i) => (
            <circle
              key={i}
              className="matching__point"
              cx={pair.target.x}
              cy={pair.target.y}
              r={Math.max(smileSize.width, smileSize.height) / 110}
            />
          ))}
        </svg>
      </div>

      <div className="matching__source">
        <p className="matching__hint">
          {pending
            ? 'Now click the same feature on the photo above.'
            : 'Click a feature here, then the same one above, to add a matching point.'}
        </p>
        <svg
          className="matching__svg matching__svg--source"
          viewBox={`0 0 ${retractedSize.width} ${retractedSize.height}`}
          data-pending={pending ? '' : undefined}
          onPointerDown={(event) => clickRetracted(localPoint(event))}
        >
          <image
            href={retracted.url}
            x={0}
            y={0}
            width={retractedSize.width}
            height={retractedSize.height}
          />
          {matching.pairs.map((pair, i) => (
            <circle
              key={i}
              className="matching__point"
              cx={pair.source.x}
              cy={pair.source.y}
              r={Math.max(retractedSize.width, retractedSize.height) / 110}
            />
          ))}
          {pending && (
            <circle
              className="matching__point matching__point--pending"
              cx={pending.x}
              cy={pending.y}
              r={Math.max(retractedSize.width, retractedSize.height) / 90}
            />
          )}
        </svg>
      </div>

      {/*
        A trustworthy automatic alignment confirms itself and this row just
        says so -- matching unlocks analysis the way every other step unlocks
        its successor. The explicit button appears only when trust is not
        earned: a marginal fit, an implausible scale, or hand-placed points,
        whose tiny residuals prove nothing.
      */}
      <div className="matching__actions">
        {matching.confirmed && matching.transform ? (
          <span className="matching__accepted">
            ✓ Alignment accepted — continue to Facial Analysis
          </span>
        ) : (
          <>
            <button
              type="button"
              className="matching__primary"
              onClick={confirmMatch}
              disabled={matching.transform === null}
            >
              Use this alignment
            </button>
            <button type="button" onClick={skipMatch}>
              Skip — design on the smile photo only
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Pointer position in the SVG's own user units. */
function localPoint(event: React.PointerEvent<SVGSVGElement>): Vec2 {
  const svg = event.currentTarget;
  const ctm = svg.getScreenCTM();
  if (!ctm) return vec(0, 0);

  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const local = point.matrixTransform(ctm.inverse());
  return vec(local.x, local.y);
}
