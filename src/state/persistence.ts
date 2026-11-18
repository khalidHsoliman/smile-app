/**
 * Local persistence.
 *
 * Everything stays on the device. The photos are patient photographs, so this
 * is IndexedDB in the clinician's own browser and nothing else -- no server, no
 * sync, no telemetry. That is the privacy decision the whole application is
 * built on, and persistence is the place it would be easiest to violate by
 * accident.
 *
 * Photos are stored as Blobs rather than object URLs: a URL is only valid for
 * the document that created it, so persisting one would restore a dead
 * reference. The URLs are recreated from the blobs on load.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { FineTuneParams, PhotoKind } from './store.js';
import type { FacialReferences } from '../domain/faceFrame.js';
import type { PointPair } from '../domain/similarity.js';
import type { Matrix2D, Vec2 } from '../domain/geometry.js';
import type { ToothEdits } from '../domain/toothEdits.js';
import type { ToothPalette } from '../vision/sampleToothColor.js';
import type { Universal } from '../domain/teeth.js';
import type { QuarterTurns } from '../domain/imageOrientation.js';
import type { Template } from '../domain/templates/types.js';

/** One photo as stored: the bytes plus what we know about them. */
export interface StoredPhoto {
  blob: Blob;
  width: number;
  height: number;
  /**
   * Legacy: rotation used to be carried beside the photo instead of baked into
   * it. Cases saved then still have a value here; restore bakes it once. New
   * saves never set it.
   */
  rotation?: QuarterTurns;
}

/**
 * A saved case.
 *
 * Deliberately stores *inputs*, not derived state: the face frame comes back
 * from the references and the tooth placements from the fit, so nothing here
 * can drift from what it was computed from.
 */
export interface StoredCase {
  id: string;
  savedAt: number;
  photos: Partial<Record<PhotoKind, StoredPhoto>>;
  selectedTeeth: Universal[];
  refs: FacialReferences | null;
  /**
   * The photo alignment's *inputs* -- the pairs, what the teeth stage
   * corrected, and the manual nudge; the transform is re-derived on restore
   *. Optional so cases saved before matching existed still load;
   * they re-align with one click.
   */
  matching?: {
    pairs: PointPair[];
    nudge: Vec2;
    /** Optional: absent in cases saved before the teeth stage could resize. */
    refinement?: Matrix2D | null;
    confirmed: boolean;
  };
  design: {
    templateId: string | null;
    params: FineTuneParams;
    palette: ToothPalette;
    paletteSampled: boolean;
    edits: ToothEdits;
    teethOpacity: number;
    lipMask: boolean;
    /** Optional: absent in cases saved before the blend pass existed. */
    photoBlend?: boolean;
    mirrorMode: boolean;
    /**
     * The template `templateId` names, when it is an imported one: it travels
     * with the case, so the case opens anywhere. Absent for a built-in
     * template, which is saved by id alone and so follows the app's updates.
     */
    template?: Template;
  };
  report: { patientName: string; clinicName: string };
  /**
   * The patient's pupil distance in mm, 40-80, that sizes in mm are worked
   * out from; null when not entered. Optional: absent in cases autosaved
   * before sizes in mm existed.
   */
  pupilDistanceMm?: number | null;
}

interface SmileDb extends DBSchema {
  cases: {
    key: string;
    value: StoredCase;
    indexes: { savedAt: number };
  };
}

const DB_NAME = 'smile-design';
const DB_VERSION = 1;

/** The single working case. Multi-case management is out of MVP scope. */
export const CURRENT_CASE = 'current';

let dbPromise: Promise<IDBPDatabase<SmileDb>> | null = null;

/**
 * How long any storage operation may take before it is abandoned.
 *
 * IndexedDB can block indefinitely rather than failing: an open in another tab
 * holds the upgrade transaction, and some environments never settle the promise
 * at all. Persistence is a convenience, so it must never be able to hold the
 * application hostage -- a timeout turns a hang into a clean "not saved".
 */
const TIMEOUT_MS = 3000;

function withTimeout<T>(work: Promise<T>, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), TIMEOUT_MS);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function db(): Promise<IDBPDatabase<SmileDb>> {
  dbPromise ??= openDB<SmileDb>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      const store = database.createObjectStore('cases', { keyPath: 'id' });
      store.createIndex('savedAt', 'savedAt');
    },
    blocked() {
      // Another tab holds an older version open. Nothing to do but let the
      // timeout fire rather than waiting forever.
    },
  });
  return dbPromise;
}

/**
 * Save the case.
 *
 * Failures are reported, never thrown at the caller: a private window, a
 * storage quota or a browser with IndexedDB disabled must degrade to a
 * working-but-unsaved session rather than breaking the design flow.
 */
export function saveCase(value: Omit<StoredCase, 'savedAt'>): Promise<boolean> {
  const work = (async () => {
    const database = await db();
    await database.put('cases', { ...value, savedAt: Date.now() });
    return true;
  })();
  return withTimeout(work, false);
}

export function loadCase(id = CURRENT_CASE): Promise<StoredCase | null> {
  const work = (async () => {
    const database = await db();
    return (await database.get('cases', id)) ?? null;
  })();
  return withTimeout(work, null);
}

export function deleteCase(id = CURRENT_CASE): Promise<void> {
  const work = (async () => {
    const database = await db();
    await database.delete('cases', id);
  })();
  // Nothing useful to do on failure -- the case is already unreachable.
  return withTimeout(work.then(() => undefined), undefined);
}

/** True when the browser can persist at all. */
export const isPersistenceAvailable = (): boolean =>
  typeof indexedDB !== 'undefined';
