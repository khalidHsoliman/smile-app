import { useEffect, useRef, type RefObject } from 'react';
import { useAppStore } from '../../state/store.js';
import {
  compose,
  toSvgMatrix,
  translation,
  vec,
  zoomAbout,
  type Vec2,
} from '../../domain/geometry.js';

/**
 * Pan and zoom for a photo stage (spec 7.3).
 *
 * One transform, held in the store and shared by the photo and every overlay --
 * the stages render their content inside a single `<g>` carrying it, so layers
 * can never drift apart. Identity is fit-to-view, and the store resets to it on
 * every step entry.
 *
 * Gestures are chosen to never collide with what a stage already does with the
 * left button (dragging handles, selecting teeth, nudging the alignment):
 *
 *  - **wheel** zooms about the cursor. Attached natively with `passive: false`,
 *    because React registers wheel listeners passively at the root and a
 *    passive listener cannot prevent the page from scrolling instead.
 *  - **middle-button drag** pans. `onPanDown/Move/Up` return true when they
 *    consume the event, so a stage calls them first and falls through to its
 *    own left-button behaviour otherwise.
 */
export function useZoom(svgRef: RefObject<SVGSVGElement | null>) {
  const transform = useAppStore((s) => s.view.transform);
  const setViewTransform = useAppStore((s) => s.setViewTransform);
  const panLast = useRef<Vec2 | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = rootPoint(svg, event.clientX, event.clientY);
      if (!point) return;
      const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
      setViewTransform(
        zoomAbout(useAppStore.getState().view.transform, point, factor),
      );
    };

    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [svgRef, setViewTransform]);

  const onPanDown = (event: React.PointerEvent<SVGSVGElement>): boolean => {
    if (event.button !== 1) return false;
    // Middle-click otherwise starts the browser's autoscroll.
    event.preventDefault();
    panLast.current = rootPoint(event.currentTarget, event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
    return true;
  };

  const onPanMove = (event: React.PointerEvent<SVGSVGElement>): boolean => {
    if (!panLast.current || !(event.buttons & 4)) return false;
    const point = rootPoint(event.currentTarget, event.clientX, event.clientY);
    if (!point) return true;
    const current = useAppStore.getState().view.transform;
    setViewTransform(
      compose(
        current,
        translation(point.x - panLast.current.x, point.y - panLast.current.y),
      ),
    );
    panLast.current = point;
    return true;
  };

  const onPanUp = (event: React.PointerEvent<SVGSVGElement>): boolean => {
    if (!panLast.current) return false;
    panLast.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    return true;
  };

  return {
    /** For the stage's single content `<g transform={...}>`. */
    groupTransform: toSvgMatrix(transform),
    scale: transform.a,
    onPanDown,
    onPanMove,
    onPanUp,
  };
}

/** Client coordinates -> the svg root's viewBox space. */
function rootPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): Vec2 | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const local = point.matrixTransform(ctm.inverse());
  return vec(local.x, local.y);
}
