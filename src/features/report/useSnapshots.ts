import { useCallback, useMemo, useState } from 'react';
import { useAppStore } from '../../state/store.js';
import { orientedSize } from '../../domain/imageOrientation.js';
import { fitArches } from '../../domain/fitting.js';
import { getTemplate } from '../../domain/templates/buildTemplate.js';
import { lipBoxFrom } from '../../domain/lipBox.js';
import type { Rect } from '../../domain/geometry.js';
import { buildDesignSvg } from '../../export/designSvg.js';
import { inlinePhoto, renderSnapshot } from '../../export/snapshot.js';

export type SnapshotKind =
  | 'smileBefore'
  | 'smileAfter'
  | 'closeBefore'
  | 'closeAfter'
  | 'retractedBefore'
  | 'retractedAfter';

export interface Snapshots {
  /** Object URLs, keyed by snapshot. Missing entries were not generated. */
  images: Partial<Record<SnapshotKind, string>>;
  /** Blobs, for export. */
  blobs: Partial<Record<SnapshotKind, Blob>>;
}

/**
 * Generates the report's snapshots (spec 8.3).
 *
 * Six images: the full smile pair, the close-up pair -- the most persuasive
 * image in the report -- and the retracted pair when that photo exists.
 *
 * All rendered at the photo's native resolution, never the viewport's. The
 * whole run is serialized behind one promise so a user who clicks twice cannot
 * have two batches racing to write the same state (spec 11.2).
 */
export function useSnapshots() {
  const photos = useAppStore((s) => s.photos);
  const frame = useAppStore((s) => s.face.frame);
  const refs = useAppStore((s) => s.face.refs);
  const selectedTeeth = useAppStore((s) => s.selectedTeeth);
  const design = useAppStore((s) => s.design);

  const [snapshots, setSnapshots] = useState<Snapshots>({ images: {}, blobs: {} });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = design.templateId ? getTemplate(design.templateId) : undefined;

  const fit = useMemo(
    () => (template ? fitArches(selectedTeeth, template, design.params) : null),
    [template, selectedTeeth, design.params],
  );

  const smileSize = photos.smile
    ? orientedSize(photos.smile, photos.smile.rotation)
    : null;

  /** The close-up crop, derived from the mouth aperture (spec 8.2). */
  const lipBox: Rect | null = useMemo(
    () =>
      refs?.mouthAperture && smileSize
        ? lipBoxFrom(refs.mouthAperture, smileSize)
        : null,
    [refs?.mouthAperture, smileSize?.width, smileSize?.height],
  );

  const generate = useCallback(async () => {
    const smile = photos.smile;
    if (!smile || !smileSize || busy) return;

    setBusy(true);
    setError(null);

    // Release the previous batch before replacing it, or every regeneration
    // leaks a handful of full-resolution images.
    for (const url of Object.values(snapshots.images)) URL.revokeObjectURL(url);

    try {
      const images: Partial<Record<SnapshotKind, string>> = {};
      const blobs: Partial<Record<SnapshotKind, Blob>> = {};

      const capture = async (
        kind: SnapshotKind,
        svg: string,
        size: { width: number; height: number },
        crop?: Rect,
      ) => {
        const blob = await renderSnapshot({
          svg,
          width: size.width,
          height: size.height,
          ...(crop ? { crop } : {}),
        });
        blobs[kind] = blob;
        images[kind] = URL.createObjectURL(blob);
      };

      const smileHref = await inlinePhoto(smile.url);

      const withDesign = (photoHref: string, size: { width: number; height: number }, rotation: number, showDesign: boolean) =>
        buildDesignSvg({
          photoHref,
          size,
          rotation,
          fit: showDesign ? fit : null,
          frame: showDesign ? frame : null,
          refs: showDesign ? refs : null,
          palette: design.palette,
          // The report shows the design at full strength regardless of the
          // working opacity, which is a comparison aid, not a design decision.
          opacity: 1,
          masked: design.lipMask,
        });

      const beforeSvg = withDesign(smileHref, smileSize, smile.rotation, false);
      const afterSvg = withDesign(smileHref, smileSize, smile.rotation, true);

      await capture('smileBefore', beforeSvg, smileSize);
      await capture('smileAfter', afterSvg, smileSize);

      if (lipBox) {
        await capture('closeBefore', beforeSvg, smileSize, lipBox);
        await capture('closeAfter', afterSvg, smileSize, lipBox);
      }

      // The retracted photo has no face frame of its own -- matching is
      // deferred (spec 15) -- so it appears as a reference pair without the
      // design rather than being wrongly overlaid.
      const retracted = photos.retracted;
      if (retracted) {
        const size = orientedSize(retracted, retracted.rotation);
        const href = await inlinePhoto(retracted.url);
        const svg = buildDesignSvg({
          photoHref: href,
          size,
          rotation: retracted.rotation,
          fit: null,
          frame: null,
          refs: null,
          palette: design.palette,
          opacity: 1,
          masked: false,
        });
        await capture('retractedBefore', svg, size);
      }

      setSnapshots({ images, blobs });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }, [photos, smileSize, fit, frame, refs, design, lipBox, busy, snapshots.images]);

  return { snapshots, generate, busy, error, lipBox, smileSize };
}
