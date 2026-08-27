import { useEffect, useRef, useState } from 'react';
import { useAppStore } from './store.js';
import { loadPhotoBlob } from './photoBlobs.js';
import {
  CURRENT_CASE,
  isPersistenceAvailable,
  loadCase,
  saveCase,
  type StoredPhoto,
} from './persistence.js';

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed' | 'unavailable';

/**
 * Autosave and restore (spec 12, in scope).
 *
 * Saves are debounced and serialized: a slider drag fires dozens of store
 * updates a second, and writing a multi-megabyte photo on each would stall the
 * tab. The debounce coalesces the burst; the in-flight guard stops two writes
 * racing to the same key (spec 11.2).
 */
const DEBOUNCE_MS = 1200;

/**
 * Identity of everything that gets persisted.
 *
 * Photos are compared by object URL rather than content: a URL changes exactly
 * when the photo does, and hashing megabytes on every store update would cost
 * more than the write it saves.
 */
function fingerprint(s: ReturnType<typeof useAppStore.getState>): string {
  return JSON.stringify([
    s.photos.smile?.url,
    s.photos.retracted?.url,
    s.selectedTeeth,
    s.face.refs,
    s.matching.pairs,
    s.matching.nudge,
    s.matching.confirmed,
    s.design.templateId,
    s.design.params,
    s.design.palette,
    s.design.paletteSampled,
    s.design.edits,
    s.design.teethOpacity,
    s.design.lipMask,
    s.design.photoBlend,
    s.design.mirrorMode,
    s.report,
  ]);
}

export function useAutosave() {
  const [state, setState] = useState<SaveState>('idle');
  const [restored, setRestored] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const pending = useRef(false);

  // --- restore, once, before autosave starts ---
  useEffect(() => {
    if (!isPersistenceAvailable()) {
      setState('unavailable');
      setRestored(true);
      return;
    }

    let cancelled = false;
    void (async () => {
      const saved = await loadCase();

      // `cancelled` guards the *restore*, never the flag. StrictMode mounts
      // effects twice in development, so the first pass is torn down while its
      // load is still in flight -- and leaving `restored` false there strands
      // the app on its loading screen forever.
      if (!cancelled && saved) {
        useAppStore.getState().restoreCase(saved);
      }
      setRestored(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // --- autosave ---
  useEffect(() => {
    if (!restored || state === 'unavailable') return;

    const write = async () => {
      if (inFlight.current) {
        // A save is already running; mark that the state moved on since it
        // started, and let it re-run when it finishes.
        pending.current = true;
        return;
      }

      inFlight.current = true;
      setState('saving');

      try {
        const s = useAppStore.getState();

        const photos: Partial<Record<'smile' | 'retracted', StoredPhoto>> = {};
        for (const kind of ['smile', 'retracted'] as const) {
          const photo = s.photos[kind];
          if (!photo) continue;
          const blob = await loadPhotoBlob(photo.url);
          if (blob) {
            photos[kind] = { blob, width: photo.width, height: photo.height };
          }
        }

        const ok = await saveCase({
          id: CURRENT_CASE,
          photos,
          selectedTeeth: s.selectedTeeth,
          refs: s.face.refs,
          matching: {
            pairs: s.matching.pairs,
            nudge: s.matching.nudge,
            confirmed: s.matching.confirmed,
          },
          design: {
            templateId: s.design.templateId,
            params: s.design.params,
            palette: s.design.palette,
            paletteSampled: s.design.paletteSampled,
            edits: s.design.edits,
            teethOpacity: s.design.teethOpacity,
            lipMask: s.design.lipMask,
            photoBlend: s.design.photoBlend,
            mirrorMode: s.design.mirrorMode,
          },
          report: s.report,
        });

        setState(ok ? 'saved' : 'failed');
      } catch {
        setState('failed');
      } finally {
        inFlight.current = false;
        if (pending.current) {
          pending.current = false;
          void write();
        }
      }
    };

    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void write(), DEBOUNCE_MS);
    };

    /*
     * Only the persisted slices trigger a write.
     *
     * Subscribing to the whole store meant every pan, wheel tick, tooth
     * selection and undo scheduled a save -- and each save re-fetches and
     * rewrites both multi-megabyte photo blobs. Panning around the design
     * produced a full IndexedDB write every 1.2 s while nothing persisted had
     * changed. Comparing a cheap fingerprint of the saved slices first makes
     * the writes match the meaning of "saved".
     */
    let previous = fingerprint(useAppStore.getState());
    const unsubscribe = useAppStore.subscribe((state) => {
      const next = fingerprint(state);
      if (next === previous) return;
      previous = next;
      schedule();
    });

    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [restored, state === 'unavailable']);

  return { state, restored };
}
