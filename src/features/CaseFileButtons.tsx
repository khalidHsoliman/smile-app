import { useRef, useState } from 'react';
import { useAppStore } from '../state/store.js';
import { buildCaseContent } from '../state/caseContent.js';
import { CASE_FILE_EXTENSION, CaseFileError, readCaseFile, writeCaseFile } from '../state/caseFile.js';
import { CURRENT_CASE } from '../state/persistence.js';
import { caseFileName } from '../export/fileNames.js';
import { downloadBlob } from '../export/snapshot.js';
import { openCaseQuestion } from './openCaseQuestion.js';

/**
 * Save case / Open case: the whole case as one `.smilecase` file.
 *
 * The file is the clinician's to keep and carry; nothing is uploaded. Opening
 * asks first, naming the patient from the file, then replaces the open case,
 * which the autosave then keeps as the current one.
 */
export function CaseFileButtons({ disabled }: { disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const s = useAppStore.getState();
      const { content, unreadablePhotos } = await buildCaseContent(s);
      if (unreadablePhotos.length > 0) {
        window.alert('The photos could not be read just now, so nothing was saved. Try Save case again.');
        return;
      }
      const now = new Date();
      downloadBlob(await writeCaseFile(content, now), caseFileName(s.report.patientName, now));
    } catch (error) {
      window.alert(error instanceof CaseFileError ? error.message : 'The case could not be saved to a file.');
    } finally {
      setBusy(false);
    }
  };

  const open = async (file: File) => {
    setBusy(true);
    try {
      // Read and check the whole file before anything else: a refused file
      // leaves the open case exactly as it was, and no question is asked.
      const opened = await readCaseFile(file);
      if (!window.confirm(openCaseQuestion(opened.content.report.patientName, opened.savedAt))) return;
      useAppStore.getState().restoreCase({ id: CURRENT_CASE, savedAt: opened.savedAt, ...opened.content });
    } catch (error) {
      window.alert(error instanceof CaseFileError ? error.message : 'The file could not be opened.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="app__action"
        disabled={disabled || busy}
        title={
          `Download this case as a ${CASE_FILE_EXTENSION} file. The file holds the patient's ` +
          'photos and name: keep and share it only as you would any patient record.'
        }
        onClick={() => void save()}
      >
        Save case
      </button>
      <button
        type="button"
        className="app__action"
        disabled={disabled || busy}
        title={`Open a case saved as a ${CASE_FILE_EXTENSION} file`}
        /*
         * Straight to the file picker; the question comes after the file is
         * read. Asking first did not work: a browser only opens a picker
         * within a few seconds of the click, and Chrome silently did nothing
         * once the clinician had spent longer than that on the question.
         */
        onClick={() => input.current?.click()}
      >
        Open case
      </button>
      <input
        ref={input}
        type="file"
        accept={CASE_FILE_EXTENSION}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so choosing the same file again still fires a change.
          event.target.value = '';
          if (file) void open(file);
        }}
      />
    </>
  );
}
