import { TemplatePicker } from './TemplatePicker.js';

/**
 * The design step (spec 6).
 *
 * Template selection is in place; arch fitting and the five fine-tune sliders
 * land next -- that is the go/no-go milestone (spec 14 step 7).
 */
export function DesignStep() {
  return (
    <div className="step step--design">
      <h2 className="step__heading">Template</h2>
      <TemplatePicker />
      <p className="placeholder">
        Arch fitting and the fine-tune sliders come next.
      </p>
    </div>
  );
}
