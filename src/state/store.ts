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

/** The five global fine-tune parameters (spec 6.4). */
export interface FineTuneParams {
  /** Width-to-length ratio. 0.10 - 1.00. */
  ratio: number;
  /** Overall arch size relative to the face. 0.10 - 4.00. */
  scale: number;
  /** Curvature of the incisal edge line. -5.0 - +5.0. */
  curveOfSpee: number;
  /** Vertical offset of the arch against the lip line. -100 - +100. */
  occlusalGap: number;
  /** Horizontal spacing between adjacent teeth. -5.0 - +5.0. */
  innerGap: number;
}

/**
 * Production-validated ranges and step sizes, adopted verbatim from the shipped
 * desktop product (spec 6.4). Used by the sliders and by `clampParams`.
 */
export const PARAM_LIMITS = {
  ratio: { min: 0.1, max: 1.0, step: 0.01 },
  scale: { min: 0.1, max: 4.0, step: 0.1 },
  curveOfSpee: { min: -5.0, max: 5.0, step: 0.1 },
  occlusalGap: { min: -100, max: 100, step: 1 },
  innerGap: { min: -5.0, max: 5.0, step: 0.1 },
} as const satisfies Record<keyof FineTuneParams, { min: number; max: number; step: number }>;

export const DEFAULT_PARAMS: FineTuneParams = {
  ratio: 0.8, // mid width:length for a central incisor (spec 1.4)
  scale: 1.0,
  curveOfSpee: 0,
  occlusalGap: 0,
  innerGap: 0,
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
    curveOfSpee: clamp('curveOfSpee'),
    occlusalGap: clamp('occlusalGap'),
    innerGap: clamp('innerGap'),
  };
}

export type PhotoKind = 'smile' | 'retracted';

export interface Photo {
  /** Object URL for the decoded image. Revoked when replaced. */
  url: string;
  width: number;
  height: number;
  /** Manual rotation in quarter turns, applied on top of EXIF (spec 3.1). */
  rotation: number;
}

export interface AppState {
  step: Step;
  unlockedSteps: Set<Step>;

  photos: Record<PhotoKind, Photo | null>;
  selectedTeeth: Universal[];

  design: {
    templateId: string | null;
    params: FineTuneParams;
  };

  // --- actions ---

  /** Navigate to a step. Ignored if the step is still locked. */
  goToStep(step: Step): void;
  /** Mark a step reachable. */
  unlockStep(step: Step): void;

  setPhoto(kind: PhotoKind, photo: Photo | null): void;
  setSelectedTeeth(teeth: Universal[]): void;
  setTemplate(templateId: string): void;
  setParams(params: Partial<FineTuneParams>): void;

  /**
   * Reset every step strictly after `from` and re-lock navigation to them.
   * The single code path for cascade invalidation -- call it from actions,
   * never from components.
   */
  invalidateAfter(from: Step): void;
}

/** Per-step reset logic, keyed by the step that owns the state. */
const RESETTERS: Record<Step, (state: AppState) => Partial<AppState>> = {
  upload: () => ({ photos: { smile: null, retracted: null }, selectedTeeth: [] }),
  matching: () => ({}),
  analysis: () => ({}),
  design: (state) => ({
    design: { ...state.design, templateId: null, params: { ...DEFAULT_PARAMS } },
  }),
  report: () => ({}),
};

export const useAppStore = create<AppState>()((set, get) => ({
  step: 'upload',
  unlockedSteps: new Set<Step>(['upload']),

  photos: { smile: null, retracted: null },
  selectedTeeth: [],

  design: { templateId: null, params: { ...DEFAULT_PARAMS } },

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
    get().invalidateAfter('upload');
  },

  setSelectedTeeth(teeth) {
    set({ selectedTeeth: [...new Set(teeth)].sort((a, b) => a - b) });
    // Tooth selection is owned by upload, but changing it must not discard the
    // photos, so invalidate from `matching` onward (spec 4.1).
    get().invalidateAfter('matching');
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
