import { useRef, useState } from 'react';
import { findTemplate, TEMPLATES } from '../../domain/templates/buildTemplate.js';
import type { Template } from '../../domain/templates/types.js';
import { useAppStore } from '../../state/store.js';
import {
  exportName,
  readTemplateFile,
  TemplateFileError,
  writeTemplateFile,
} from '../../state/templateFile.js';
import { templateFileName } from '../../export/fileNames.js';
import { downloadBlob } from '../../export/snapshot.js';

/** The run shown in each thumbnail: canine to canine, the usual treatment zone. */
const PREVIEW_RUN = [6, 7, 8, 9, 10, 11];

/**
 * Template selection, import and export.
 *
 * Each option previews its own tooth set rather than naming it alone -- the
 * choice is a conversation the clinician has with the patient, and the
 * difference between the sets is visual, not verbal.
 *
 * Templates imported into the case are listed after the built-in ones and
 * chosen the same way. Export downloads the selected template as a file to
 * edit and import -- a built-in one as a copy, "Natural (copy)". A file that
 * cannot be used leaves everything as it was and says why, under the buttons,
 * until it is dismissed or the next import or export: the message names the
 * place in the file, so it has to stay readable while the file is fixed.
 */
export function TemplatePicker() {
  const templateId = useAppStore((s) => s.design.templateId);
  const importedTemplates = useAppStore((s) => s.importedTemplates);
  const setTemplate = useAppStore((s) => s.setTemplate);

  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const selected = findTemplate(templateId, importedTemplates);
  const imported = new Set(importedTemplates.map((t) => t.id));

  const importFile = async (file: File) => {
    setBusy(true);
    setProblem(null);
    try {
      const template = await readTemplateFile(file);
      const store = useAppStore.getState();
      store.addImportedTemplate(template);
      // Chosen straight away: that is what it was imported for. If it is the
      // one in use already, choosing it changes nothing (see `setTemplate`).
      store.setTemplate(template.id);
    } catch (error) {
      setProblem(error instanceof TemplateFileError ? error.message : 'The file could not be read.');
    } finally {
      setBusy(false);
    }
  };

  const exportSelected = () => {
    if (!selected) return;
    setProblem(null);
    try {
      downloadBlob(writeTemplateFile(selected), templateFileName(exportName(selected)));
    } catch (error) {
      setProblem(error instanceof TemplateFileError ? error.message : 'The template could not be exported.');
    }
  };

  return (
    <div className="templates__picker">
      <div className="templates">
        {[...TEMPLATES, ...importedTemplates].map((template) => (
          <button
            key={template.id}
            type="button"
            className="template"
            aria-pressed={template.id === templateId}
            onClick={() => setTemplate(template.id)}
          >
            <TemplateThumbnail template={template} />
            <span className="template__name">
              {template.name}
              {imported.has(template.id) && <span className="template__badge">Imported</span>}
            </span>
            {template.description && (
              <span className="template__description">{template.description}</span>
            )}
          </button>
        ))}
      </div>

      <div className="templates__actions">
        <button
          type="button"
          className="sliders__reset"
          disabled={busy}
          title="Add a tooth template from a file, exported from this app and edited, to this case"
          /* Straight to the file picker, as Open case does: a browser only
             opens one within a few seconds of the click. */
          onClick={() => input.current?.click()}
        >
          Import template…
        </button>
        <button
          type="button"
          className="sliders__reset"
          disabled={busy || !selected}
          title={
            selected
              ? `Download "${selected.name}" as a file to edit and import`
              : 'Choose a template to export'
          }
          onClick={exportSelected}
        >
          Export selected
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared so choosing the same file again, once fixed, still fires.
            event.target.value = '';
            if (file) void importFile(file);
          }}
        />
      </div>

      {problem && (
        <p className="templates__problem" role="alert">
          {problem}{' '}
          <button type="button" className="sliders__reset" onClick={() => setProblem(null)}>
            OK
          </button>
        </p>
      )}
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
