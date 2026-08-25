/**
 * The linear workflow (spec 4).
 *
 * Each step unlocks the next, and editing an earlier step invalidates every
 * later one. That cascade is the single most important architectural
 * constraint in the application (spec 4.1, 11.1).
 */

/*
 * Photo matching sat between upload and analysis in the previous product,
 * aligning the retracted photo to the smile photo. Spec 15 defers it for the
 * MVP: the design happens on the smile photo, and the retracted one is a visual
 * reference plus a second before/after pair in the report. It was a
 * do-nothing pass-through here, and a step that exists but does nothing is
 * worse than no step in a flow whose target is under five minutes.
 */
export const STEPS = ['upload', 'analysis', 'design', 'report'] as const;

export type Step = (typeof STEPS)[number];

/** Steps strictly after `from`, in workflow order. */
export function stepsAfter(from: Step): Step[] {
  return STEPS.slice(STEPS.indexOf(from) + 1);
}

/** Workflow position, for ordering comparisons. */
export const stepIndex = (step: Step): number => STEPS.indexOf(step);
