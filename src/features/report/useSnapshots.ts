import { useCallback, useMemo, useState } from 'react';
import { useAppStore } from '../../state/store.js';
import { fitArches } from '../../domain/fitting.js';
import { applyEdits } from '../../domain/toothEdits.js';
import { getTemplate } from '../../domain/templates/buildTemplate.js';
import { lipBoxFrom } from '../../domain/lipBox.js';
import type { Rect } from '../../domain/geometry.js';
import { alignedFaceFrame, withoutAperture } from '../../domain/alignedFrame.js';
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
 * Generates the report's snapshots.
 *
 * Six images: the full smile pair, the close-up pair -- the most persuasive
 * image in the report -- and the retracted pair when that photo exists.
 *
 * All rendered at the photo's native resolution, never the viewport's. The
 * whole run is serialized behind one promise so a user who clicks twice cannot
 * have two batches racing to write the same state.
 */
export function useSnapshots() {
  const photos = useAppStore((s) => s.photos);
  const frame = useAppStore((s) => s.face.frame);
  const refs = useAppStore((s) => s.face.refs);
  const selectedTeeth = useAppStore((s) => s.selectedTeeth);
  const design = useAppStore((s) => s.design);
  const matching = useAppStore((s) => s.matching);

  const [snapshots, setSnapshots] = useState<Snapshots>({ images: {}, blobs: {} });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = design.templateId ? getTemplate(design.templateId) : undefined;

  /*
   * The fit *with* the per-tooth edits applied. The report must show exactly
   * what the clinician approved on screen -- exporting the raw fit would
   * silently discard every manual adjustment, which is the worst possible bug
   * in a patient-facing deliverable.
   */
  const fit = useMemo(() => {
    if (!template) return null;
    const fitted = fitArches(selectedTeeth, template, design.params);
    return { ...fitted, teeth: applyEdits(fitted.teeth, design.edits) };
  }, [template, selectedTeeth, design.params, design.edits]);

  const smileSize = photos.smile;

  const alignedFrame = useMemo(
    () => alignedFaceFrame(frame, matching.transform),
    [frame, matching.transform],
  );
  const alignedRefs = useMemo(() => withoutAperture(refs), [refs]);

  /** The close-up crop, derived from the mouth aperture. */
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

      const withDesign = (photoHref: string, size: { width: number; height: number }, showDesign: boolean) =>
        buildDesignSvg({
          photoHref,
          size,
          fit: showDesign ? fit : null,
          frame: showDesign ? frame : null,
          refs: showDesign ? refs : null,
          palette: design.palette,
          // The report shows the design at full strength regardless of the
          // working opacity, which is a comparison aid, not a design decision.
          opacity: 1,
          masked: design.lipMask,
          blend: design.photoBlend,
        });

      const beforeSvg = withDesign(smileHref, smileSize, false);
      const afterSvg = withDesign(smileHref, smileSize, true);

      await capture('smileBefore', beforeSvg, smileSize);
      await capture('smileAfter', afterSvg, smileSize);

      if (lipBox) {
        await capture('closeBefore', beforeSvg, smileSize, lipBox);
        await capture('closeAfter', afterSvg, smileSize, lipBox);
      }

      /*
       * The retracted pair.
       *
       * The design lives in the smile photo's coordinates, so showing it on the
       * retracted view needs the matching transform. With an
       * alignment we invert it -- mapping the smile-photo frame into retracted
       * coordinates -- and get a true second before/after pair. Without one the
       * retracted photo appears as a reference only; overlaying an unaligned
       * design would place teeth confidently in the wrong place, which is worse
       * than not showing them.
       */
      const retracted = photos.retracted;
      if (retracted) {
        const size = retracted;
        const href = await inlinePhoto(retracted.url);

        const plain = buildDesignSvg({
          photoHref: href,
          size,
          fit: null,
          frame: null,
          refs: null,
          palette: design.palette,
          opacity: 1,
          masked: false,
          blend: false,
        });
        await capture('retractedBefore', plain, size);

        if (alignedFrame && refs) {
          const withTeeth = buildDesignSvg({
            photoHref: href,
            size,
            fit,
            frame: alignedFrame,
            refs: alignedRefs ?? refs,
            palette: design.palette,
            opacity: 1,
            // The aperture is in smile-photo coordinates; masking with it would
            // clip against the wrong mouth.
            masked: false,
            // The design is aligned to *this* photo, so it is this photo's
            // light the teeth should pick up.
            blend: design.photoBlend,
          });
          await capture('retractedAfter', withTeeth, size);
        }
      }

      setSnapshots({ images, blobs });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }, [photos, smileSize, fit, frame, refs, design, lipBox, busy, snapshots.images]);

  return { snapshots, generate, busy, error, lipBox, smileSize, fit, template };
}
