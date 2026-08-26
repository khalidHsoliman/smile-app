/**
 * The application store.
 *
 * Two rules this file exists to enforce:
 *
 * 1. Cascade invalidation (spec 4.1) happens in exactly one place --
 *    `invalidateAfter`. Components never reset a downstream step themselves.
 * 2. Derived state stays derived (spec 9.1). The face frame comes from the
 *    references; tooth placements come from frame + template + params. Nothing
 *    is stored twice.
 */

import { create } from 'zustand';
import { STEPS, type Step, stepIndex, stepsAfter } from './steps.js';
import { mirrorOf, type Universal } from '../domain/teeth.js';
import {
  alignmentError,
  fitSimilarity,
  type PointPair,
} from '../domain/similarity.js';
import { IDENTITY, type Matrix2D } from '../domain/geometry.js';
import { rotateBy, type QuarterTurns } from '../domain/imageOrientation.js';
import {
  computeFaceFrame,
  type FaceFrame,
  type FacialReferences,
} from '../domain/faceFrame.js';
import { DEFAULT_TEMPLATE_ID } from '../domain/templates/buildTemplate.js';
import { DEFAULT_PALETTE, type ToothPalette } from '../vision/sampleToothColor.js';
import {
  clearEdits,
  editTooth,
  mirrorEdit,
  type ToothEdit,
  type ToothEdits,
} from '../domain/toothEdits.js';
import type { StoredCase } from './persistence.js';
import {
  canRedo,
  canUndo,
  clearHistory,
  initHistory,
  push,
  redo,
  replace,
  undo,
  type History,
} from '../domain/history.js';

/**
 * The global fine-tune parameters.
 *
 * Spec 6.4 inherited five from the previous desktop product. Three are kept,
 * one renamed, one replaced and one added -- see `domain/fitting.ts` for the
 * reasoning behind each change.
 */
export interface FineTuneParams {
  /** Width-to-length ratio of the central incisor. Clinical target 0.80. */
  ratio: number;
  /** Overall arch size relative to the face. */
  scale: number;
  /** Curvature of the incisal edge, following the lower lip. */
  smileCurve: number;
  /** Vertical offset of the arch against the lip line. */
  occlusalGap: number;
  /** RED proportion: 0.62 golden, 0.70 normal, 0.80 short face. */
  redProportion: number;
  /** Arch width -- the buccal corridor. 1.0 leaves the span as fitted. */
  archWidth: number;
}

/**
 * Production-validated ranges and step sizes, adopted verbatim from the shipped
 * desktop product (spec 6.4). Used by the sliders and by `clampParams`.
 */
export const PARAM_LIMITS = {
  /*
   * Narrowed from the inherited 0.10-1.00. Below about 0.55 a central incisor
   * is anatomically impossible, so most of that travel was unusable and the
   * clinically meaningful band was a small part of the track. 0.55-0.95
   * comfortably contains the 0.70-0.90 working range and the 0.80 target.
   */
  ratio: { min: 0.55, max: 0.95, step: 0.01 },
  scale: { min: 0.1, max: 4.0, step: 0.05 },
  smileCurve: { min: -5.0, max: 5.0, step: 0.1 },
  occlusalGap: { min: -100, max: 100, step: 1 },
  /*
   * The published RED band: 0.62 golden proportion (tall faces), 0.70 normal,
   * 0.80 short faces. A little headroom either side for judgment.
   */
  redProportion: { min: 0.55, max: 0.85, step: 0.01 },
  /* +/- 25% of the fitted span covers narrow-to-wide buccal corridors. */
  archWidth: { min: 0.75, max: 1.25, step: 0.01 },
} as const satisfies Record<keyof FineTuneParams, { min: number; max: number; step: number }>;

export const DEFAULT_PARAMS: FineTuneParams = {
  ratio: 0.8, // the clinical target for a central incisor (spec 1.4)
  scale: 1.0,
  smileCurve: 1.0, // a visible smile arc by default; flat reads as artificial
  occlusalGap: 0,
  redProportion: 0.7, // normal facial height
  archWidth: 1.0,
};

/** Clamp each parameter into its validated range. */
export function clampParams(params: FineTuneParams): FineTuneParams {
  const clamp = (key: keyof FineTuneParams): number => {
    const { min, max } = PARAM_LIMITS[key];
    return Math.min(max, Math.max(min, params[key]));
  };
  return {
    ratio: clamp('ratio'),
    scale: clamp('scale'),
    smileCurve: clamp('smileCurve'),
    occlusalGap: clamp('occlusalGap'),
    redProportion: clamp('redProportion'),
    archWidth: clamp('archWidth'),
  };
}

export type PhotoKind = 'smile' | 'retracted';

export interface Photo {
  /** Object URL for the decoded image. Revoked when replaced. */
  url: string;
  width: number;
  height: number;
  /** Manual rotation in quarter turns, applied on top of EXIF (spec 3.1). */
  rotation: QuarterTurns;
}

export interface AppState {
  step: Step;
  unlockedSteps: Set<Step>;

  photos: Record<PhotoKind, Photo | null>;
  selectedTeeth: Universal[];

  /**
   * Alignment of the retracted photo onto the smile photo (spec 15).
   *
   * `pairs` is what the clinician places or the detector seeds; `transform` is
   * derived from them and never edited directly, so the two cannot drift
   * (spec 9.1). Null transform means the photos are not yet aligned.
   */
  matching: {
    pairs: PointPair[];
    transform: Matrix2D | null;
    /** RMS residual in pixels -- how well the pairs agree with each other. */
    error: number;
    /** True once the clinician has accepted the alignment. */
    confirmed: boolean;
  };

  /**
   * Facial analysis (spec 5). `refs` is what the user edits; `frame` is derived
   * from it and never edited directly (spec 9.1).
   */
  face: {
    refs: FacialReferences | null;
    frame: FaceFrame | null;
    /** Set when the references are degenerate -- shown next to the handles. */
    error: string | null;
  };

  design: {
    templateId: string | null;
    params: FineTuneParams;
    /**
     * Opacity of the tooth layer. A first-class control, not a buried one:
     * toggling it to compare against the original was the previous product's
     * most-used control (spec 7.1).
     */
    teethOpacity: number;
    /** Clip the design to the mouth aperture (spec 7.1). */
    lipMask: boolean;
    /**
     * Enamel colours. Sampled from the patient's own photo when possible, so
     * the design sits naturally against their skin and the shot's lighting.
     * An approximation, never a shade match.
     */
    palette: ToothPalette;
    /** True when the clinician chose the shade by hand. */
    paletteSampled: boolean;
    /** The photo-derived palette, kept so "Use photo colour" can restore it. */
    sampledPalette: ToothPalette | null;
    /**
     * Per-tooth adjustments, as deltas on top of the computed fit (spec 11.6).
     * Never replacements -- that is what lets a global slider change and a
     * manual nudge coexist.
     */
    edits: ToothEdits;
    /** Teeth the user has selected for editing. */
    selection: Universal[];
    /** Apply every edit to the contralateral partner as well (spec 6.5). */
    mirrorMode: boolean;
  };

  /**
   * One pan/zoom transform shared by the photo and every overlay (spec 7.3).
   * Layers must never transform independently.
   */
  view: { transform: Matrix2D };

  /**
   * Undo history over the design (spec 9.3).
   *
   * Only genuine design decisions are tracked. View preferences -- teeth
   * opacity, the lip-mask toggle, the current selection -- are deliberately
   * excluded: undo should step back through what the clinician *designed*, not
   * change how they happen to be looking at it.
   */
  history: History<DesignSnapshot>;

  /** Open undo batches. Zero means each change pushes its own entry. */
  undoBatchDepth: number;

  /** Report header fields (spec 8.1). Not design inputs -- purely metadata. */
  report: {
    patientName: string;
    clinicName: string;
  };

  /**
   * True while a slider is being dragged. Undo batching keys off this, and the
   * renderer can use it to skip expensive work mid-drag.
   */
  paramDragActive: boolean;

  // --- actions ---

  /** Navigate to a step. Ignored if the step is still locked. */
  goToStep(step: Step): void;
  /** Mark a step reachable. */
  unlockStep(step: Step): void;

  setPhoto(kind: PhotoKind, photo: Photo | null): void;
  /** Rotate a photo by `delta` quarter turns. Does not re-decode. */
  rotatePhoto(kind: PhotoKind, delta: number): void;
  setSelectedTeeth(teeth: Universal[]): void;
  setViewTransform(transform: Matrix2D): void;

  /**
   * Replace the facial references and re-derive the frame. Every reference edit
   * goes through here, so the frame can never drift from its inputs.
   */
  setFacialReferences(refs: FacialReferences | null): void;

  /** Replace the matching point pairs and re-derive the transform. */
  setMatchPairs(pairs: PointPair[]): void;
  /** Accept the current alignment and open the next step. */
  confirmMatch(): void;
  /** Skip alignment entirely -- valid when there is no retracted photo. */
  skipMatch(): void;
  /** Re-evaluate whether the matching step's exit condition is met. */
  syncMatchGate(): void;

  /** Re-evaluate whether the upload step's exit condition is met. */
  syncUploadGate(): void;
  /** Re-evaluate whether the analysis step's exit condition is met. */
  syncAnalysisGate(): void;
  /** Re-evaluate whether the report is reachable. */
  syncDesignGate(): void;
  setTemplate(templateId: string): void;
  setParams(params: Partial<FineTuneParams>): void;
  setTeethOpacity(opacity: number): void;
  setLipMask(enabled: boolean): void;
  /**
   * Set the enamel palette. `manual` marks it as a deliberate choice rather
   * than a photo sample, which changes what the UI says about it.
   */
  setPalette(palette: ToothPalette | null, manual?: boolean): void;
  setReportField(field: 'patientName' | 'clinicName', value: string): void;

  /** Replace the editing selection. */
  setToothSelection(teeth: Universal[]): void;
  /** Add or remove one tooth from the editing selection. */
  toggleToothSelection(tooth: Universal, extend: boolean): void;
  /** Apply a delta to every selected tooth. */
  nudgeSelection(delta: ToothEdit): void;
  /** Return the selected teeth to their computed placement. */
  resetSelection(): void;
  setMirrorMode(enabled: boolean): void;

  /**
   * Open an undo batch. Everything until `endUndoBatch` collapses into the one
   * entry pushed here, so a slider drag is one undo step and not one per pixel
   * (spec 9.3).
   */
  startUndoBatch(): void;
  endUndoBatch(): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  /** Rehydrate a saved case. Replaces the whole working state. */
  restoreCase(saved: StoredCase): void;
  /** Discard the working case and start over. */
  clearCase(): void;
  /**
   * Mark the start of a slider drag. Everything until `endParamDrag` is one
   * user action and must collapse into a single undo entry (spec 9.3).
   */
  beginParamDrag(): void;
  endParamDrag(): void;
  /** Return the five parameters to their defaults. */
  resetParams(): void;

  /**
   * Reset every step strictly after `from` and re-lock navigation to them.
   * The single code path for cascade invalidation -- call it from actions,
   * never from components.
   */
  invalidateAfter(from: Step): void;
}

/** Per-step reset logic, keyed by the step that owns the state. */
const RESETTERS: Record<Step, (state: AppState) => Partial<AppState>> = {
  // Upload owns the photos and the tooth selection. `invalidateAfter` only ever
  // resets steps *after* its argument, so this entry is reached solely by an
  // explicit `invalidateAfter` from before upload -- which cannot happen, upload
  // being first. It is kept for completeness of the record and must stay
  // consistent with the initial state.
  upload: () => ({ photos: { smile: null, retracted: null }, selectedTeeth: [] }),
  matching: () => ({
    matching: { pairs: [], transform: null, error: 0, confirmed: false },
  }),
  analysis: () => ({ face: { refs: null, frame: null, error: null } }),
  design: (state) => ({
    design: {
      ...state.design,
      templateId: DEFAULT_TEMPLATE_ID,
      params: { ...DEFAULT_PARAMS },
      // Manual edits are anchored to a particular fit; once the design is
      // invalidated they no longer mean anything.
      edits: {},
      selection: [],
    },
  }),
  report: () => ({}),
};

/**
 * The part of the design that undo tracks.
 *
 * Deliberately not the whole design slice: `teethOpacity`, `lipMask` and
 * `selection` are how the clinician is *looking* at the design, not decisions
 * about it, and stepping back through them would be surprising.
 */
export interface DesignSnapshot {
  templateId: string | null;
  params: FineTuneParams;
  edits: ToothEdits;
}

const snapshotOf = (design: AppState['design']): DesignSnapshot => ({
  templateId: design.templateId,
  params: { ...design.params },
  edits: { ...design.edits },
});

/**
 * Record a design change in the history.
 *
 * Every design mutation routes through here rather than each action deciding
 * for itself, so an action cannot silently forget to be undoable. Inside an
 * open batch this replaces the present instead of pushing, which is what makes
 * a slider drag one entry rather than one per value (spec 9.3).
 */
function record(
  state: AppState,
  design: AppState['design'],
): Pick<AppState, 'design' | 'history'> {
  const snapshot = snapshotOf(design);

  // Outside a batch: push the state *before* this change onto the past, then
  // advance the present to the new one. Pushing alone would leave `present`
  // stale, so the next undo would restore a value that was never live.
  //
  // Inside a batch: the entry was already pushed when the batch opened, so this
  // only advances the present -- which is what collapses a whole drag into one
  // undo step (spec 9.3).
  const history =
    state.undoBatchDepth > 0
      ? replace(state.history, snapshot)
      : replace(push(state.history, snapshotOf(state.design)), snapshot);

  return { design, history };
}

export const useAppStore = create<AppState>()((set, get) => ({
  step: 'upload',
  unlockedSteps: new Set<Step>(['upload']),

  photos: { smile: null, retracted: null },
  selectedTeeth: [],

  matching: { pairs: [], transform: null, error: 0, confirmed: false },
  face: { refs: null, frame: null, error: null },
  design: {
    templateId: DEFAULT_TEMPLATE_ID,
    params: { ...DEFAULT_PARAMS },
    teethOpacity: 0.9,
    lipMask: true,
    palette: DEFAULT_PALETTE,
    paletteSampled: false,
    sampledPalette: null,
    edits: {},
    selection: [],
    mirrorMode: true,
  },
  view: { transform: IDENTITY },
  history: initHistory<DesignSnapshot>({
    templateId: DEFAULT_TEMPLATE_ID,
    params: { ...DEFAULT_PARAMS },
    edits: {},
  }),
  undoBatchDepth: 0,
  report: { patientName: '', clinicName: '' },
  paramDragActive: false,

  goToStep(step) {
    if (!get().unlockedSteps.has(step)) return;
    // Undoing across a step transition produces incoherent states -- a design
    // whose facial references no longer exist -- so the history is dropped at
    // the boundary (spec 9.3).
    set((state) => ({ step, history: clearHistory(state.history) }));
  },

  unlockStep(step) {
    set((state) => {
      if (state.unlockedSteps.has(step)) return state;
      return { unlockedSteps: new Set(state.unlockedSteps).add(step) };
    });
  },

  invalidateAfter(from) {
    set((state) => {
      let patch: Partial<AppState> = {};
      const unlocked = new Set(state.unlockedSteps);

      for (const step of stepsAfter(from)) {
        patch = { ...patch, ...RESETTERS[step]({ ...state, ...patch }) };
        unlocked.delete(step);
      }

      // Navigation must not be left pointing at a step we just re-locked.
      const step = unlocked.has(state.step) ? state.step : from;
      return { ...patch, unlockedSteps: unlocked, step };
    });
  },

  setPhoto(kind, photo) {
    const previous = get().photos[kind];
    if (previous && previous.url !== photo?.url) URL.revokeObjectURL(previous.url);

    set((state) => ({ photos: { ...state.photos, [kind]: photo } }));

    // Losing the smile photo invalidates the design surface itself, so the
    // tooth selection made against it goes too.
    if (kind === 'smile' && photo === null) set({ selectedTeeth: [] });

    get().invalidateAfter('upload');
    get().syncUploadGate();
  },

  rotatePhoto(kind, delta) {
    const photo = get().photos[kind];
    if (!photo) return;

    set((state) => ({
      photos: {
        ...state.photos,
        [kind]: { ...photo, rotation: rotateBy(photo.rotation, delta) },
      },
    }));
    // Rotation changes the design surface, so everything downstream is stale.
    get().invalidateAfter('upload');
  },

  setViewTransform(transform) {
    set({ view: { transform } });
  },

  setFacialReferences(refs) {
    if (refs === null) {
      set({ face: { refs: null, frame: null, error: null } });
    } else {
      // The frame is derived here and nowhere else, so it cannot drift from the
      // references that produced it (spec 9.1). Degenerate references are
      // surfaced rather than silently yielding a plausible-but-wrong frame.
      try {
        set({ face: { refs, frame: computeFaceFrame(refs), error: null } });
      } catch (cause) {
        set({ face: { refs, frame: null, error: (cause as Error).message } });
      }
    }

    // Any reference change re-fits the teeth, so everything downstream is stale
    // (spec 5.4). Invalidate *before* re-gating: invalidateAfter re-locks every
    // later step, so unlocking first would immediately be undone.
    get().invalidateAfter('analysis');
    get().syncAnalysisGate();
  },

  /**
   * The analysis step's exit condition: a usable face frame. Authoritative in
   * both directions, for the same reason `syncUploadGate` is.
   */
  syncAnalysisGate() {
    if (get().face.frame !== null) {
      get().unlockStep('design');
      get().syncDesignGate();
      return;
    }

    set((state) => {
      const unlocked = new Set(state.unlockedSteps);
      for (const step of stepsAfter('analysis')) unlocked.delete(step);
      return {
        unlockedSteps: unlocked,
        step: unlocked.has(state.step) ? state.step : 'analysis',
      };
    });
  },

  /**
   * The upload step's exit condition (spec 4.2): a smile photo and at least one
   * selected tooth. The retracted photo is recommended but the MVP degrades
   * gracefully without it (spec 3.1), so it is not gated on.
   *
   * Authoritative in *both* directions. Unlocking only would let a step stay
   * reachable after the user removed the photo or cleared the selection that
   * opened it -- the stale-downstream-state trap of spec 11.1.
   */
  syncUploadGate() {
    const { photos, selectedTeeth } = get();
    const satisfied = photos.smile !== null && selectedTeeth.length > 0;

    if (satisfied) {
      get().unlockStep('matching');

      /*
       * With no retracted photo there is nothing to align, so matching is
       * auto-confirmed and the clinician never sees it. The step exists only
       * when it has work to do -- which keeps the common single-photo case
       * inside the five-minute target.
       */
      if (get().photos.retracted === null) {
        get().skipMatch();
      } else {
        get().syncMatchGate();
      }
      return;
    }

    set((state) => {
      const unlocked = new Set(state.unlockedSteps);
      for (const step of stepsAfter('upload')) unlocked.delete(step);
      return {
        unlockedSteps: unlocked,
        step: unlocked.has(state.step) ? state.step : 'upload',
      };
    });
  },

  setSelectedTeeth(teeth) {
    set({ selectedTeeth: [...new Set(teeth)].sort((a, b) => a - b) });
    // Tooth selection belongs to upload, so everything after upload is stale --
    // but the photos themselves must survive, which is why this invalidates
    // from `upload` rather than resetting upload's own state (spec 4.1).
    get().invalidateAfter('upload');
    get().syncUploadGate();
  },

  setTemplate(templateId) {
    // Per-tooth edits are deltas against a particular set of tooth shapes, so a
    // different template makes them meaningless -- a nudge that squared up a
    // Natural canine means nothing on a Hollywood one. `invalidateAfter` cannot
    // do this: it only resets steps *after* its argument, never design's own
    // state, so the clearing has to be explicit.
    set((state) =>
      record(state, { ...state.design, templateId, edits: {}, selection: [] }),
    );
    get().invalidateAfter('design');
    get().syncDesignGate();
  },

  setParams(params) {
    set((state) =>
      record(state, {
        ...state.design,
        params: clampParams({ ...state.design.params, ...params }),
      }),
    );
    get().invalidateAfter('design');
    get().syncDesignGate();
  },

  beginParamDrag() {
    // The drag is already open if the pointer went down and a key repeat
    // follows, so this is idempotent on purpose.
    if (get().paramDragActive) return;
    set({ paramDragActive: true });
    get().startUndoBatch();
  },

  endParamDrag() {
    if (!get().paramDragActive) return;
    set({ paramDragActive: false });
    get().endUndoBatch();
  },

  setTeethOpacity(opacity) {
    set((state) => ({
      design: { ...state.design, teethOpacity: Math.min(1, Math.max(0, opacity)) },
    }));
    // Opacity is a view preference, not design input -- it invalidates nothing.
  },

  setLipMask(enabled) {
    set((state) => ({ design: { ...state.design, lipMask: enabled } }));
    // A view preference, like opacity -- it invalidates nothing.
  },

  setPalette(palette, manual = false) {
    set((state) => ({
      design: {
        ...state.design,
        palette: palette ?? DEFAULT_PALETTE,
        paletteSampled: manual,
        // A photo sample is remembered so the clinician can return to it after
        // trying a shade by hand.
        sampledPalette:
          !manual && palette !== null ? palette : state.design.sampledPalette,
      },
    }));
    // Colour is presentation, not design geometry -- nothing downstream is
    // stale because of it.
  },

  setMatchPairs(pairs) {
    // The transform is derived here and nowhere else, so it cannot drift from
    // the pairs that produced it (spec 9.1). Fewer than two pairs leaves it
    // null rather than guessing -- a plausible-looking identity would render a
    // misaligned overlay with no visible cause.
    let transform: Matrix2D | null = null;
    let error = 0;
    try {
      transform = fitSimilarity(pairs);
      error = alignmentError(pairs, transform);
    } catch {
      transform = null;
    }

    set((state) => ({
      matching: { ...state.matching, pairs, transform, error, confirmed: false },
    }));
    get().invalidateAfter('matching');
    get().syncMatchGate();
  },

  confirmMatch() {
    if (get().matching.transform === null) return;
    set((state) => ({ matching: { ...state.matching, confirmed: true } }));
    get().syncMatchGate();
  },

  skipMatch() {
    // Valid whether or not a retracted photo exists: the design happens on the
    // smile photo, so an unaligned retracted view simply appears in the report
    // as a reference rather than a second before/after pair.
    set((state) => ({
      matching: { ...state.matching, transform: null, confirmed: true },
    }));
    get().syncMatchGate();
  },

  /**
   * The matching step's exit condition: confirmed, either by accepting an
   * alignment or by skipping it. Authoritative in both directions, like the
   * other gates.
   */
  syncMatchGate() {
    if (get().matching.confirmed) {
      get().unlockStep('analysis');
      return;
    }

    set((state) => {
      const unlocked = new Set(state.unlockedSteps);
      for (const step of stepsAfter('matching')) unlocked.delete(step);
      return {
        unlockedSteps: unlocked,
        step: unlocked.has(state.step) ? state.step : 'matching',
      };
    });
  },

  setToothSelection(teeth) {
    set((state) => ({
      design: { ...state.design, selection: [...new Set(teeth)].sort((a, b) => a - b) },
    }));
  },

  toggleToothSelection(tooth, extend) {
    set((state) => {
      const current = new Set(state.design.selection);
      if (extend) {
        if (current.has(tooth)) current.delete(tooth);
        else current.add(tooth);
      } else {
        // A plain click replaces the selection unless it is already the only
        // thing selected, in which case it deselects.
        const only = current.size === 1 && current.has(tooth);
        current.clear();
        if (!only) current.add(tooth);
      }
      return {
        design: { ...state.design, selection: [...current].sort((a, b) => a - b) },
      };
    });
  },

  nudgeSelection(delta) {
    const { selection, mirrorMode, edits } = get().design;
    if (selection.length === 0) return;

    const selected = new Set(selection);
    let next = edits;

    for (const tooth of selection) {
      const partner = mirrorOf(tooth);
      const partnerSelected = selected.has(partner) && partner !== tooth;

      if (!mirrorMode) {
        next = editTooth(next, tooth, delta, false);
        continue;
      }

      if (partnerSelected) {
        /*
         * Both partners are selected, so each is reached by the loop on its own
         * turn. Applying the mirrored delta here as well would double it.
         *
         * Instead each tooth takes the delta oriented to *its* side, so the
         * pair moves symmetrically -- pressing "right" walks them apart rather
         * than sliding both the same way, which is what mirror mode means.
         * Teeth on the patient's right (universal <= the arch's right central)
         * take the reflected delta.
         */
        const onRight = tooth <= (tooth <= 16 ? 8 : 24);
        next = editTooth(next, tooth, onRight ? mirrorEdit(delta) : delta, false);
      } else {
        // Only this tooth is selected: edit it and reflect onto its partner.
        next = editTooth(next, tooth, delta, true);
      }
    }

    set((state) => record(state, { ...state.design, edits: next }));
    // Edits are deltas on the fit, so nothing upstream is stale -- but the
    // report's snapshots are, and they regenerate on entry.
  },

  resetSelection() {
    const { selection, mirrorMode } = get().design;
    if (selection.length === 0) return;

    const affected = mirrorMode
      ? selection.flatMap((t) => [t, mirrorOf(t)])
      : selection;

    set((state) =>
      record(state, {
        ...state.design,
        edits: clearEdits(state.design.edits, affected),
      }),
    );
  },

  setMirrorMode(enabled) {
    set((state) => ({ design: { ...state.design, mirrorMode: enabled } }));
  },

  /*
   * Undo batching (spec 9.3).
   *
   * `startUndoBatch` records the state *before* the action. Every change while
   * the batch is open replaces the present rather than pushing, so the whole
   * gesture -- a slider drag, a template import, a run of nudges -- collapses
   * into that single entry.
   */
  startUndoBatch() {
    if (get().undoBatchDepth > 0) {
      // Nested batches share the outermost one, so a compound action that calls
      // several batched operations still produces exactly one undo entry.
      set((state) => ({ undoBatchDepth: state.undoBatchDepth + 1 }));
      return;
    }
    set((state) => ({
      undoBatchDepth: 1,
      history: push(state.history, snapshotOf(state.design)),
    }));
  },

  endUndoBatch() {
    set((state) => ({
      undoBatchDepth: Math.max(0, state.undoBatchDepth - 1),
    }));
  },

  undo() {
    const { history } = get();
    if (!canUndo(history)) return;

    const next = undo(history);
    set((state) => ({
      history: next,
      design: { ...state.design, ...next.present, selection: [] },
    }));
  },

  redo() {
    const { history } = get();
    if (!canRedo(history)) return;

    const next = redo(history);
    set((state) => ({
      history: next,
      design: { ...state.design, ...next.present, selection: [] },
    }));
  },

  canUndo: () => canUndo(get().history),
  canRedo: () => canRedo(get().history),

  restoreCase(saved) {
    // Photos come back as Blobs; the object URLs are recreated here because a
    // persisted URL would be a dead reference (see `persistence.ts`).
    const photos: AppState['photos'] = { smile: null, retracted: null };
    for (const kind of ['smile', 'retracted'] as const) {
      const stored = saved.photos[kind];
      if (!stored) continue;
      photos[kind] = {
        url: URL.createObjectURL(stored.blob),
        width: stored.width,
        height: stored.height,
        rotation: stored.rotation,
      };
    }

    set((state) => ({
      photos,
      selectedTeeth: saved.selectedTeeth,
      design: { ...state.design, ...saved.design, selection: [] },
      report: saved.report,
      // The frame is derived, never stored, so it is recomputed below from the
      // restored references (spec 9.1).
      face: { refs: null, frame: null, error: null },
      history: initHistory({
        templateId: saved.design.templateId,
        params: saved.design.params,
        edits: saved.design.edits,
      }),
    }));

    // Re-run the gates so the restored case lands on the right step with the
    // right steps unlocked, rather than trusting a persisted flag.
    get().syncUploadGate();
    if (saved.refs) get().setFacialReferences(saved.refs);
  },

  clearCase() {
    for (const kind of ['smile', 'retracted'] as const) {
      const photo = get().photos[kind];
      if (photo) URL.revokeObjectURL(photo.url);
    }
    set({
      step: 'upload',
      unlockedSteps: new Set<Step>(['upload']),
      photos: { smile: null, retracted: null },
      selectedTeeth: [],
      face: { refs: null, frame: null, error: null },
      design: {
        templateId: DEFAULT_TEMPLATE_ID,
        params: { ...DEFAULT_PARAMS },
        teethOpacity: 0.9,
        lipMask: true,
        palette: DEFAULT_PALETTE,
        paletteSampled: false,
        sampledPalette: null,
        edits: {},
        selection: [],
        mirrorMode: true,
      },
      report: { patientName: '', clinicName: '' },
      history: initHistory({
        templateId: DEFAULT_TEMPLATE_ID,
        params: { ...DEFAULT_PARAMS },
        edits: {},
      }),
    });
  },

  /**
   * The design step's exit condition: a usable frame and a template.
   *
   * This has to be its own gate rather than a one-off unlock inside
   * `syncAnalysisGate`. Every design action calls `invalidateAfter('design')`,
   * which re-locks every later step -- so a report unlocked once when the
   * references landed was re-locked by the first slider move and never came
   * back. Same shape as the upload and analysis gates: invalidate, then re-gate.
   */
  syncDesignGate() {
    const { face, design } = get();
    if (face.frame !== null && design.templateId !== null) {
      get().unlockStep('report');
      return;
    }

    set((state) => {
      const unlocked = new Set(state.unlockedSteps);
      for (const step of stepsAfter('design')) unlocked.delete(step);
      return {
        unlockedSteps: unlocked,
        step: unlocked.has(state.step) ? state.step : 'design',
      };
    });
  },

  setReportField(field, value) {
    set((state) => ({ report: { ...state.report, [field]: value } }));
    // Metadata only -- it invalidates nothing.
  },

  resetParams() {
    set((state) =>
      record(state, { ...state.design, params: { ...DEFAULT_PARAMS } }),
    );
    get().invalidateAfter('design');
    get().syncDesignGate();
  },
}));

/** True if `step` is at or before the furthest unlocked step. */
export function isStepReachable(state: AppState, step: Step): boolean {
  return state.unlockedSteps.has(step);
}

/** The steps, in order, paired with their unlocked flag -- for the nav bar. */
export function stepNavItems(state: AppState): Array<{ step: Step; unlocked: boolean; current: boolean }> {
  return STEPS.map((step) => ({
    step,
    unlocked: state.unlockedSteps.has(step),
    current: step === state.step,
  }));
}

export { STEPS, stepIndex };
export type { Step };
