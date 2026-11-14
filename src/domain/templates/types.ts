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

import type { Vec2 } from '../geometry.js';
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
  /** Closed SVG path in the local frame. 8-20 control points. */
  outline: string;
  /** Width relative to the central incisor at 1.0. */
  width: number;
  /** Length (incisal to gingival) in the same units as `width`. */
  length: number;
  /** Gum-line high point, local frame. A flat gum line reads as artificial. */
  gingivalZenith: Vec2;
  /** The biting edge, local frame, used for smile-arc fitting. */
  incisalEdge: Vec2[];
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
}
