/**
 * Tooth template types.
 *
 * A template is a set of idealized tooth shapes with a consistent aesthetic
 * character. Template choice is a conversation the clinician has with the
 * patient, so the names matter as much as the geometry.
 *
 * Everything here is normalized to the **central incisor width = 1.0**. Nothing
 * is in millimetres or pixels: the arch fitter scales the whole set against the
 * face frame, so a template is a set of *proportions*, not measurements.
 */

import type { Universal } from '../teeth.js';

/**
 * One tooth, in its own local frame.
 *
 * Local frame: origin at the **incisal midpoint** -- the middle of the biting
 * edge -- with +x toward the patient's left and +y upward toward the gum. The
 * incisal edge is the anchor because that is what gets laid along the smile
 * curve, and anchoring there means the smile arc is exact while any error
 * accumulates harmlessly up at the gum line.
 */
export interface ToothTemplate {
  universal: Universal;
  /**
   * Closed SVG path in the local frame, written with absolute `M`, `L`, `C`,
   * `Q` and `Z` only: the design's bounding box reads the numbers as x,y pairs
   * (see `controlPoints` in ToothLayer), and imported templates are held to
   * the same rule (see `state/templateFile.ts`).
   */
  outline: string;
  /** Width relative to the central incisor at 1.0. */
  width: number;
  /** Length (incisal to gingival) in the same units as `width`. */
  length: number;
  /**
   * How far this tooth's incisal edge sits *above* the central's, in width
   * units. Positive means shorter. Laterals are ~0.5-1mm shorter and canines
   * return to about the central's level -- this is what produces the
   * characteristic gull-wing arc.
   */
  incisalOffset: number;
}

export interface Template {
  id: string;
  /** Shown to the clinician: "Natural", "Hollywood". */
  name: string;
  /** One-line description of the aesthetic character. */
  description: string;
  teeth: Record<Universal, ToothTemplate>;
  /**
   * How the Ratio and Tooth proportion sliders act on this template.
   *
   * - `'absolute'`, the built-in templates: the slider values *are* the
   *   proportions drawn -- the central's width:length, and the lateral's and
   *   canine's widths -- whatever the template's own. The template supplies
   *   the shapes, each tooth's length relative to its central, the back
   *   teeth's widths and the incisal offsets.
   * - `'relative'`, imported templates: the sliders start at the template's
   *   own proportions (see `proportions.ts`), where every tooth is drawn
   *   exactly as authored, and move the teeth from there.
   *
   * Not in the template file: it follows from where the template came from.
   */
  sliders: 'absolute' | 'relative';
}
