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
import { suggestFitParams } from '../domain/suggestParams.js';
import { isTrustworthyAlignment } from '../domain/autoMatch.js';
import {
  IDENTITY,
  compose,
  translation,
  vec,
  type Matrix2D,
  type Vec2,
} from '../domain/geometry.js';
import { bakeRotation } from '../features/upload/bakeRotation.js';
import type { QuarterTurns } from '../domain/imageOrientation.js';
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

/**
 * Rebuild `matching.transform` from its inputs (spec 9.1).
 *
 * The transform is derived, never edited: it is the landmark similarity, then
 * whatever the teeth stage corrected, then whatever the clinician nudged. One
 * place composes those three so the order cannot drift between the automatic
 * path and the arrow keys.
 *
 * Returns false when there is nothing to derive from.
 */
function rederiveMatch(
  get: () => AppState,
  set: (fn: (state: AppState) => Partial<AppState>) => void,
  patch: { nudge?: Vec2; refinement?: Matrix2D | null },
): boolean {
  const current = get().matching;
  if (current.transform === null) return false;

  let fitted: Matrix2D;
  try {
    fitted = fitSimilarity(current.pairs);
  } catch {
    return false;
  }

  const nudge = patch.nudge ?? current.nudge;
  const refinement =
    patch.refinement !== undefined ? patch.refinement : current.refinement;

  const correction = compose(
    refinement ?? IDENTITY,
    translation(nudge.x, nudge.y),
  );

  set((state) => ({
    matching: {
      ...state.matching,
      nudge,
      refinement,
      transform: compose(fitted, correction),
    },
  }));
  return true;
}

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

/**
 * A photo, always the right way up.
 *
 * There is deliberately no rotation field: rotation is baked into the pixels
 * when applied (see `features/upload/bakeRotation`), so `width` and `height`
 * are always what the clinician sees and no consumer has to re-derive an
 * oriented size. Carrying rotation as data leaked a coordinate system into
 * every render site and four of them got it wrong.
 */
export interface Photo {
  /** Object URL for the decoded image. Revoked when replaced. */
  url: string;
  width: number;
  height: number;
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
    /**
     * What the teeth stage corrected, on top of the landmark fit.
     *
     * A matrix, not an offset, because it carries a scale about the mouth as
     * well as a translation -- a retracted photograph is taken closer than a
     * smile photograph, and a similarity fitted on the eyes and nose comes out
     * right for the upper face and wrong at the mouth. Kept separate from
     * `nudge` so that re-running the automatic alignment replaces the machine's
     * correction without discarding the clinician's.
     */
    refinement: Matrix2D | null;
    transform: Matrix2D | null;
    /** RMS residual in pixels -- how well the pairs agree with each other. */
    error: number;
    /** True once the clinician has accepted the alignment. */
    confirmed: boolean;
    /**
     * Manual fine-tune offset in smile-photo pixels, dragged on the overlay
     * (spec 15 stage 3). Stored as an input; the transform is re-derived from
     * pairs + nudge, never edited directly (spec 9.1). This is the escape
     * valve for what a similarity fit cannot model -- head pitch between the
     * two shots moves the mouth relative to the eyes, and only a human can say
     * where the teeth should sit.
     */
    nudge: Vec2;
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
     * Carry the photograph's own light onto the design, so it sits *in* the
     * photo rather than on top of it.
     *
     * A viewing preference like the mask, and **off** by default. It is a
     * genuine improvement on some photographs and a muddier arch on others,
     * depending on how much of the design covers lip and shadow rather than the
     * old teeth, so the honest default is the design's own drawn colour and the
     * clinician turns the pass on if it flatters this case.
     *
     */
    photoBlend: boolean;
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
  /** Snapshot staged by an open batch, pushed on its first real change. */
  pendingUndo: DesignSnapshot | null;

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
  /** Rotate a photo by `delta` quarter turns, baking it into the pixels. */
  rotatePhoto(kind: PhotoKind, delta: number): Promise<void>;
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
  /** Shift the fitted alignment by (dx, dy) smile-photo pixels. */
  nudgeMatch(dx: number, dy: number): void;
  /** Record what the teeth stage corrected, and re-derive the transform. */
  setMatchRefinement(refinement: Matrix2D | null): void;
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
  setPhotoBlend(enabled: boolean): void;
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
  /** Load the built-in synthetic demo case. */
  loadDemoCase(): Promise<void>;
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
    matching: {
      pairs: [],
      transform: null,
      error: 0,
      confirmed: false,
      nudge: vec(0, 0),
      refinement: null,
    },
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
 * Deliberately not the whole design slice: `teethOpacity`, `lipMask`,
 * `photoBlend` and `selection` are how the clinician is *looking* at the
 * design, not decisions about it, and stepping back through them would be
 * surprising.
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
): Pick<AppState, 'design' | 'history'> & { pendingUndo?: DesignSnapshot | null } {
  const snapshot = snapshotOf(design);

  // Outside a batch: push the state *before* this change onto the past, then
  // advance the present to the new one. Pushing alone would leave `present`
  // stale, so the next undo would restore a value that was never live.
  //
  // Inside a batch: the entry was already pushed when the batch opened, so this
  // only advances the present -- which is what collapses a whole drag into one
  // undo step (spec 9.3).
  if (state.undoBatchDepth > 0) {
    // First change inside a batch commits the snapshot staged when it opened;
    // later ones only advance the present, collapsing the gesture to one entry.
    const history = state.pendingUndo
      ? replace(push(state.history, state.pendingUndo), snapshot)
      : replace(state.history, snapshot);
    return { design, history, pendingUndo: null };
  }

  return {
    design,
    history: replace(push(state.history, snapshotOf(state.design)), snapshot),
  };
}

export const useAppStore = create<AppState>()((set, get) => ({
  step: 'upload',
  unlockedSteps: new Set<Step>(['upload']),

  photos: { smile: null, retracted: null },
  selectedTeeth: [],

  matching: {
    pairs: [],
    transform: null,
    error: 0,
    confirmed: false,
    nudge: vec(0, 0),
    refinement: null,
  },
  face: { refs: null, frame: null, error: null },
  design: {
    templateId: DEFAULT_TEMPLATE_ID,
    params: { ...DEFAULT_PARAMS },
    teethOpacity: 0.9,
    lipMask: true,
    photoBlend: false,
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
  pendingUndo: null,
  report: { patientName: '', clinicName: '' },
  paramDragActive: false,

  goToStep(step) {
    if (!get().unlockedSteps.has(step)) return;
    // Undoing across a step transition produces incoherent states -- a design
    // whose facial references no longer exist -- so the history is dropped at
    // the boundary (spec 9.3). The view resets too: fit-to-view on entry to
    // every step, because steps have different natural framings (spec 7.3).
    set((state) => ({
      step,
      history: clearHistory(state.history),
      view: { transform: IDENTITY },
    }));
  },

  unlockStep(step) {
    set((state) => {
      if (state.unlockedSteps.has(step)) return state;

      /*
       * A step can only open if the one before it is already open.
       *
       * Each gate checks its own exit condition and nothing else, so without
       * this a later gate could open its successor while an earlier one was
       * shut. That is how a hard refresh came to show Facial Analysis with no
       * photo loaded at all: a restored case carried a confirmed alignment from
       * an earlier session, syncMatchGate saw `confirmed` and opened analysis,
       * and the fact that upload was unsatisfied never entered into it.
       *
       * Enforcing the chain here fixes every gate at once and makes the broken
       * state unreachable, rather than adding a fourth guard that the fifth
       * gate would then need too.
       */
      const index = stepIndex(step);
      const previous = STEPS[index - 1];
      if (previous !== undefined && !state.unlockedSteps.has(previous)) {
        return state;
      }

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

  async rotatePhoto(kind, delta) {
    const photo = get().photos[kind];
    if (!photo) return;

    let rotated: Photo;
    try {
      rotated = await bakeRotation(photo, delta);
    } catch {
      // Leave the photo as it was; a failed rotate must not lose the upload.
      return;
    }

    set((state) => ({ photos: { ...state.photos, [kind]: rotated } }));
    // Rotation changes the design surface, so everything downstream is stale...
    get().invalidateAfter('upload');
    /*
     * ...and then re-gate. Without this the rotate button re-locked every later
     * step and nothing ever reopened them: the exit condition (a smile photo
     * and a tooth selection) is still satisfied, but only setPhoto and
     * setSelectedTeeth re-checked it, so a single rotate stranded the user on
     * upload until they happened to re-toggle a tooth.
     */
    get().syncUploadGate();
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

    /*
     * Seed the placement parameters from this photo's own mouth aperture.
     *
     * The invalidation above just reset the design to fixed defaults, which
     * assume an average face; the aperture says where *this* mouth actually
     * is, so scale and occlusalGap start there and the sliders begin as
     * refinements rather than corrections. Applied after the reset, and as the
     * new history baseline rather than an undoable action -- there is no
     * previous design for undo to return to.
     */
    const { face } = get();
    if (face.refs && face.frame) {
      const suggested = suggestFitParams(face.refs, face.frame);
      if (suggested) {
        set((state) => {
          const params = clampParams({ ...state.design.params, ...suggested });
          return {
            design: { ...state.design, params },
            history: initHistory({
              templateId: state.design.templateId,
              params,
              edits: { ...state.design.edits },
            }),
          };
        });
      }
    }
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

  setPhotoBlend(enabled) {
    set((state) => ({ design: { ...state.design, photoBlend: enabled } }));
    // Likewise: it changes how the design is shown, not what it is.
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

    // A trustworthy automatic alignment confirms itself -- matching then
    // unlocks analysis exactly the way every other step unlocks its successor,
    // with no ritual click. Marginal fits and hand-placed pairs stay explicit.
    const confirmed =
      transform !== null && isTrustworthyAlignment(pairs, transform, error);

    set(() => ({
      // New pairs are a fresh alignment; an old correction belonged to the
      // fit it corrected and would silently skew this one.
      matching: {
        pairs,
        transform,
        error,
        confirmed,
        nudge: vec(0, 0),
        refinement: null,
      },
    }));
    get().invalidateAfter('matching');
    get().syncMatchGate();
  },

  nudgeMatch(dx, dy) {
    const { nudge } = get().matching;
    const next = vec(nudge.x + dx, nudge.y + dy);
    if (!rederiveMatch(get, set, { nudge: next })) return;
    // The nudge moves where the retracted overlay sits; the design lives in
    // smile-photo coordinates and is untouched. Nothing is invalidated -- the
    // report and the design-step reference derive from the live transform.
  },

  setMatchRefinement(refinement) {
    /*
     * The machine's correction replaces any earlier machine correction and
     * clears the hand nudge with it: a nudge was aimed at the *previous*
     * alignment, and carrying it onto a new one would apply a correction twice.
     */
    rederiveMatch(get, set, { refinement, nudge: vec(0, 0) });
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
    /*
     * The entry is only *staged* here, not pushed. A pointer-down on a slider
     * opens a batch whether or not the value ends up changing, and pushing
     * eagerly minted a phantom undo step and -- worse -- discarded the redo
     * stack on a click that changed nothing. `record` pushes the staged
     * snapshot on the first real change instead.
     */
    set((state) => ({
      undoBatchDepth: 1,
      pendingUndo: snapshotOf(state.design),
    }));
  },

  endUndoBatch() {
    set((state) => ({
      undoBatchDepth: Math.max(0, state.undoBatchDepth - 1),
      // A gesture that changed nothing leaves nothing behind.
      pendingUndo: state.undoBatchDepth <= 1 ? null : state.pendingUndo,
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
    // Cases saved before rotation was baked still carry it; applied below.
    const legacyRotations: Partial<Record<PhotoKind, QuarterTurns | undefined>> = {};
    for (const kind of ['smile', 'retracted'] as const) {
      const stored = saved.photos[kind];
      if (!stored) continue;
      photos[kind] = {
        url: URL.createObjectURL(stored.blob),
        width: stored.width,
        height: stored.height,
      };
      legacyRotations[kind] = stored.rotation;
    }

    set(() => ({
      photos,
      selectedTeeth: saved.selectedTeeth,
      report: saved.report,
      // The frame is derived, never stored, so it is recomputed below from the
      // restored references (spec 9.1).
      face: { refs: null, frame: null, error: null },
    }));

    // Re-run the gates so the restored case lands on the right step with the
    // right steps unlocked, rather than trusting a persisted flag.
    get().syncUploadGate();

    // Replay the alignment *before* the references: setMatchPairs invalidates
    // everything after matching, so restoring it afterwards would wipe them.
    const savedMatch = saved.matching;
    if (savedMatch) {
      if (savedMatch.pairs.length >= 2) {
        get().setMatchPairs(savedMatch.pairs);
        // The teeth correction first: it is what the nudge was aimed at.
        if (savedMatch.refinement) {
          get().setMatchRefinement(savedMatch.refinement);
        }
        if (savedMatch.nudge.x !== 0 || savedMatch.nudge.y !== 0) {
          get().nudgeMatch(savedMatch.nudge.x, savedMatch.nudge.y);
        }
        if (savedMatch.confirmed && !get().matching.confirmed) {
          get().confirmMatch();
        }
      } else if (savedMatch.confirmed) {
        // A confirmed record with no pairs is a skipped alignment.
        get().skipMatch();
      }
    }

    if (saved.refs) get().setFacialReferences(saved.refs);

    /*
     * The saved design goes on LAST, and this ordering is the whole point.
     *
     * Replaying the alignment and the references above runs
     * `invalidateAfter`, whose design resetter clears the template, the
     * parameters and every per-tooth edit -- and `setFacialReferences` then
     * seeds fresh parameters from the aperture. Applying the saved design
     * first, as this did, meant every restore silently discarded the
     * clinician's actual work behind a "Saved" indicator: the one bug that
     * makes persistence worse than none.
     *
     * The history is re-initialised rather than pushed: a restored case is a
     * new baseline, and undo must not step back into a state from a different
     * session.
     */
    set((state) => ({
      design: { ...state.design, ...saved.design, selection: [] },
      history: initHistory({
        templateId: saved.design.templateId,
        params: saved.design.params,
        edits: saved.design.edits,
      }),
    }));

    // Legacy stored rotations are baked in afterwards, which re-runs the
    // cascade for those cases only. New saves never reach this.
    for (const kind of ['smile', 'retracted'] as const) {
      const turns = legacyRotations[kind];
      if (turns) void get().rotatePhoto(kind, turns);
    }
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
        photoBlend: false,
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

  async loadDemoCase() {
    const { buildDemoCase } = await import('../features/demo/demoCase.js');
    const demo = await buildDemoCase();

    get().clearCase();
    get().setPhoto('smile', demo.smile);
    get().setPhoto('retracted', demo.retracted);
    // The anterior six: the usual treatment zone, and what the demo designs.
    get().setSelectedTeeth([6, 7, 8, 9, 10, 11]);
    set({ report: { patientName: 'Demo case', clinicName: '' } });
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
