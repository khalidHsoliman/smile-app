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
import type { Universal } from '../domain/teeth.js';
import { IDENTITY, type Matrix2D } from '../domain/geometry.js';
import { rotateBy, type QuarterTurns } from '../domain/imageOrientation.js';
import {
  computeFaceFrame,
  type FaceFrame,
  type FacialReferences,
} from '../domain/faceFrame.js';
import { DEFAULT_TEMPLATE_ID } from '../domain/templates/buildTemplate.js';
import { DEFAULT_PALETTE, type ToothPalette } from '../vision/sampleToothColor.js';

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
    /** True when `palette` came from the photo rather than the default. */
    paletteSampled: boolean;
  };

  /**
   * One pan/zoom transform shared by the photo and every overlay (spec 7.3).
   * Layers must never transform independently.
   */
  view: { transform: Matrix2D };

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

  /** Re-evaluate whether the upload step's exit condition is met. */
  syncUploadGate(): void;
  /** Re-evaluate whether the analysis step's exit condition is met. */
  syncAnalysisGate(): void;
  setTemplate(templateId: string): void;
  setParams(params: Partial<FineTuneParams>): void;
  setTeethOpacity(opacity: number): void;
  setLipMask(enabled: boolean): void;
  /** Adopt a sampled palette, or pass null to return to the default. */
  setPalette(palette: ToothPalette | null): void;
  setReportField(field: 'patientName' | 'clinicName', value: string): void;
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
  analysis: () => ({ face: { refs: null, frame: null, error: null } }),
  design: (state) => ({
    design: {
      ...state.design,
      templateId: DEFAULT_TEMPLATE_ID,
      params: { ...DEFAULT_PARAMS },
    },
  }),
  report: () => ({}),
};

export const useAppStore = create<AppState>()((set, get) => ({
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
  },
  view: { transform: IDENTITY },
  report: { patientName: '', clinicName: '' },
  paramDragActive: false,

  goToStep(step) {
    if (!get().unlockedSteps.has(step)) return;
    set({ step });
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
      // A design exists the moment the frame does -- the default template and
      // parameters already produce a fit -- so the report is reachable too.
      get().unlockStep('report');
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
      get().unlockStep('analysis');
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
    set((state) => ({ design: { ...state.design, templateId } }));
    get().invalidateAfter('design');
  },

  setParams(params) {
    set((state) => ({
      design: { ...state.design, params: clampParams({ ...state.design.params, ...params }) },
    }));
    get().invalidateAfter('design');
  },

  beginParamDrag() {
    // The drag is already open if the pointer went down and a key repeat
    // follows, so this is idempotent on purpose.
    if (!get().paramDragActive) set({ paramDragActive: true });
  },

  endParamDrag() {
    if (get().paramDragActive) set({ paramDragActive: false });
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

  setPalette(palette) {
    set((state) => ({
      design: {
        ...state.design,
        palette: palette ?? DEFAULT_PALETTE,
        paletteSampled: palette !== null,
      },
    }));
    // Colour is presentation, not design geometry -- nothing downstream is
    // stale because of it.
  },

  setReportField(field, value) {
    set((state) => ({ report: { ...state.report, [field]: value } }));
    // Metadata only -- it invalidates nothing.
  },

  resetParams() {
    set((state) => ({
      design: { ...state.design, params: { ...DEFAULT_PARAMS } },
    }));
    get().invalidateAfter('design');
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
