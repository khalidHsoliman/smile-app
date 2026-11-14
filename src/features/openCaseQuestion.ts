/**
 * The question asked before an opened case file replaces the open case.
 *
 * It names the patient from the file, so the clinician can see they picked the
 * right one. That name comes from outside the app and lands in a browser
 * dialog, so it is shown tamed: on one line, without the invisible direction
 * overrides that could make it display as something else, and not so long it
 * pushes the question off the dialog. It is also isolated, so an Arabic or
 * Hebrew name cannot reorder the English sentence around it.
 *
 * No npm imports: the tests run this under plain Node.
 */

const MAX_SHOWN = 80;

/** Explicit direction controls: embeddings, overrides, isolates and marks. */
const DIRECTION_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

/** First strong isolate ... pop directional isolate. */
const isolate = (text: string) => `\u2068${text}\u2069`;

/** The patient's name as it may be shown in the question; '' for none. */
export function shownPatientName(patientName: string): string {
  const name = patientName
    .replace(DIRECTION_CONTROLS, '')
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim();
  const chars = Array.from(name);
  return chars.length > MAX_SHOWN ? `${chars.slice(0, MAX_SHOWN).join('').trimEnd()}…` : name;
}

export function openCaseQuestion(patientName: string, savedAt: number, locale?: string): string {
  const name = shownPatientName(patientName);
  const when = new Date(savedAt).toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short' });
  const which = name ? `the case of “${isolate(name)}”` : 'this case (no patient name)';
  return (
    `Open ${which}, saved ${when}?\n\n` +
    'It replaces the case that is open now. Save that one first if you want to keep it.'
  );
}
