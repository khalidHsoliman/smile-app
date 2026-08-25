import { TEMPLATES } from '../../domain/templates/buildTemplate.js';
import type { Template } from '../../domain/templates/types.js';
import { useAppStore } from '../../state/store.js';

/** The run shown in each thumbnail: canine to canine, the usual treatment zone. */
const PREVIEW_RUN = [6, 7, 8, 9, 10, 11];

/**
 * Template selection (spec 6.1).
 *
 * Each option previews its own tooth set rather than naming it alone -- the
 * choice is a conversation the clinician has with the patient, and the
 * difference between the sets is visual, not verbal.
 */
export function TemplatePicker() {
  const templateId = useAppStore((s) => s.design.templateId);
  const setTemplate = useAppStore((s) => s.setTemplate);

  return (
    <div className="templates">
      {TEMPLATES.map((template) => (
        <button
          key={template.id}
          type="button"
          className="template"
          aria-pressed={template.id === templateId}
          onClick={() => setTemplate(template.id)}
        >
          <TemplateThumbnail template={template} />
          <span className="template__name">{template.name}</span>
          <span className="template__description">{template.description}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * A straight-line preview of the set: incisal edges on a common baseline with
 * each tooth's own incisal offset applied, so the smile arc and the gingival
 * scallop are both visible. This is not the arch fit -- that lands in step 7.
 */
function TemplateThumbnail({ template }: { template: Template }) {
  const teeth = PREVIEW_RUN.map((universal) => template.teeth[universal]).filter(
    (t): t is NonNullable<typeof t> => t !== undefined,
  );

  const totalWidth = teeth.reduce((sum, t) => sum + t.width, 0);
  const maxTop = Math.max(...teeth.map((t) => t.length - t.incisalOffset));

  let cursor = -totalWidth / 2;

  return (
    <svg
      className="template__preview"
      viewBox={`${-totalWidth / 2 - 0.1} ${-maxTop - 0.15} ${totalWidth + 0.2} ${maxTop + 0.4}`}
      aria-hidden="true"
    >
      {/* +y is toward the gum in tooth-local space; flip so it draws upward. */}
      <g transform="scale(1,-1)">
        {teeth.map((tooth) => {
          const centre = cursor + tooth.width / 2;
          cursor += tooth.width;
          return (
            <path
              key={tooth.universal}
              d={tooth.outline}
              transform={`translate(${centre} ${-tooth.incisalOffset})`}
            />
          );
        })}
      </g>
    </svg>
  );
}
