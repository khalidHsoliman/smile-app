/**
 * Where the Ratio and Tooth proportion sliders start for a template.
 *
 * The two kinds of template use the sliders differently (see `Template.sliders`):
 *
 * - The built-in templates take the slider values *as* the proportions: the
 *   central's width:length and the lateral's and canine's widths, whatever the
 *   template's own. They start at the published targets, 0.80 and 0.70.
 * - An imported template starts at its own proportions -- its upper right
 *   central's (FDI 11) width:length and its upper right lateral's (FDI 12)
 *   width as a share of the central's -- where every tooth is drawn exactly as
 *   the file has it. The sliders move the teeth from there.
 *
 * Pure: no React, no store, no DOM.
 */

import { UPPER_CENTRALS } from '../teeth.js';
import type { Template } from './types.js';

/**
 * The Ratio and Tooth proportion sliders' ranges and steps. The store's
 * `PARAM_LIMITS` takes them from here, and an imported template's own
 * proportions must fall inside them (see `state/templateFile.ts`).
 */
export const PROPORTION_LIMITS = {
  /*
   * Narrowed from the inherited 0.10-1.00. Below about 0.55 a central incisor
   * is anatomically impossible, so most of that travel was unusable and the
   * clinically meaningful band was a small part of the track. 0.55-0.95
   * comfortably contains the 0.70-0.90 working range and the 0.80 target.
   */
  ratio: { min: 0.55, max: 0.95, step: 0.01 },
  /*
   * The published RED band: 0.62 golden proportion (tall faces), 0.70 normal,
   * 0.80 short faces. A little headroom either side for judgment.
   */
  redProportion: { min: 0.55, max: 0.85, step: 0.01 },
} as const;

export interface Proportions {
  /** Width:length of the central incisor, the Ratio slider. */
  ratio: number;
  /** Lateral width as a share of the central's, the Tooth proportion slider. */
  redProportion: number;
}

/** Where the built-in templates start: the published targets. */
export const BUILT_IN_START: Proportions = { ratio: 0.8, redProportion: 0.7 };

/** The upper right central and lateral, universal numbers (FDI 11 and 12). */
const CENTRAL = UPPER_CENTRALS[0];
const LATERAL = CENTRAL - 1;

/**
 * A template's own proportions, from its upper right central (FDI 11) and
 * lateral (FDI 12). Undefined if it lacks either.
 */
export function ownProportions(teeth: Template['teeth']): Proportions | undefined {
  const central = teeth[CENTRAL];
  const lateral = teeth[LATERAL];
  if (!central || !lateral) return undefined;
  return {
    ratio: central.width / central.length,
    redProportion: lateral.width / central.width,
  };
}

/**
 * Where the sliders go when `template` is chosen, and on Reset: the built-in
 * targets for a built-in template, its own proportions for an imported one.
 */
export function startingProportions(template: Template): Proportions {
  if (template.sliders === 'absolute') return BUILT_IN_START;
  return ownProportions(template.teeth) ?? BUILT_IN_START;
}
