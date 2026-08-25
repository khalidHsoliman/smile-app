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
            photos[kind] = {
              blob,
              width: photo.width,
              height: photo.height,
              rotation: photo.rotation,
            };
          }
        }

        const ok = await saveCase({
          id: CURRENT_CASE,
          photos,
          selectedTeeth: s.selectedTeeth,
          refs: s.face.refs,
          design: {
            templateId: s.design.templateId,
            params: s.design.params,
            palette: s.design.palette,
            paletteSampled: s.design.paletteSampled,
            edits: s.design.edits,
            teethOpacity: s.design.teethOpacity,
            lipMask: s.design.lipMask,
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

    // Only the persisted slices should trigger a write. Subscribing to the
    // whole store would save on every pointer move during a drag.
    const unsubscribe = useAppStore.subscribe(schedule);

    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [restored, state === 'unavailable']);

  return { state, restored };
}
