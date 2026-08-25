/**
 * The linear workflow (spec 4).
 *
 * Each step unlocks the next, and editing an earlier step invalidates every
 * later one. That cascade is the single most important architectural
 * constraint in the application (spec 4.1, 11.1).
 */

export const STEPS = ['upload', 'matching', 'analysis', 'design', 'report'] as const;

export type Step = (typeof STEPS)[number];

/** Steps strictly after `from`, in workflow order. */
export function stepsAfter(from: Step): Step[] {
  return STEPS.slice(STEPS.indexOf(from) + 1);
}

/** Workflow position, for ordering comparisons. */
export const stepIndex = (step: Step): number => STEPS.indexOf(step);
