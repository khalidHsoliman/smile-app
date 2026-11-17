import type { FacialReferences } from '../../domain/faceFrame.js';
import type { PlacedTooth } from '../../domain/fitting.js';
import type { Template } from '../../domain/templates/types.js';
import {
  dentalMidlineOffset,
  faceMeasurements,
  formatMidline,
  formatOffset,
  formatPercent,
  formatSize,
  formatSizeBasis,
  formatTilt,
  toothMeasurements,
  toothSizes,
  type Where,
} from '../../domain/measurements.js';

interface MeasurementsProps {
  refs: FacialReferences | null;
  /** The design as shown: the fit with the per-tooth edits applied. */
  teeth: readonly PlacedTooth[] | null;
  template: Template | undefined;
  /** The patient's pupil distance in mm, that sizes in mm come from; null when not entered. */
  pupilDistanceMm: number | null;
  /** The panel says why a value is "-"; the report shows a plain "-". */
  where: Where;
  /**
   * Download the measurements as a file. Given, a "CSV" button shows under the
   * table -- on screen only, like the report's PNG buttons.
   */
  onDownload?: () => void;
}

/**
 * The numbers a clinician reads off a design, shown in the Design step's panel
 * and in the report. One component for both, so the two cannot disagree.
 *
 * Everything is worked out and worded in `domain/measurements.ts`; this only
 * lays it out. Every row is always shown, with "-" when it cannot be worked out
 * -- except in the report without a pupil distance, which leaves out the sizes
 * in mm and the line saying what they come from, rather than print a block of
 * "-" on every case that has none.
 */
export function Measurements({
  refs,
  teeth,
  template,
  pupilDistanceMm,
  where,
  onDownload,
}: MeasurementsProps) {
  const face = faceMeasurements(refs);
  const { right, left } = toothMeasurements(teeth, template);
  const sizes = toothSizes(refs, teeth, template, pupilDistanceMm);
  const basis = formatSizeBasis(pupilDistanceMm);
  const showSizes = where === 'panel' || basis !== null;

  const toothRows = [
    ['Central width : length', right.centralWidthToLength, left.centralWidthToLength],
    ['Lateral / central', right.lateralToCentral, left.lateralToCentral],
    ['Canine / central', right.canineToCentral, left.canineToCentral],
  ] as const;

  const sizeRows = [
    ['Central', sizes.right.central, sizes.left.central],
    ['Lateral', sizes.right.lateral, sizes.left.lateral],
    ['Canine', sizes.right.canine, sizes.left.canine],
  ] as const;

  return (
    <section className={`measurements measurements--${where}`}>
      <h2>Measurements</h2>
      <table>
        <tbody>
          <tr>
            <th scope="row">Head tilt</th>
            <td colSpan={2}>{formatTilt(face.headTilt, where)}</td>
          </tr>
          <tr>
            <th scope="row">Midline cant</th>
            <td colSpan={2}>{formatMidline(face.midlineCant, where)}</td>
          </tr>
          <tr>
            <th scope="row">Lip line cant</th>
            <td colSpan={2}>{formatTilt(face.lipLineCant, where)}</td>
          </tr>
          <tr>
            <th scope="row">Dental midline offset</th>
            <td colSpan={2}>
              {formatOffset(dentalMidlineOffset(refs, teeth, template, pupilDistanceMm), where)}
            </td>
          </tr>
        </tbody>
        <tbody>
          <tr>
            <th scope="col">Upper teeth</th>
            <th scope="col">Right (11–13)</th>
            <th scope="col">Left (21–23)</th>
          </tr>
          {toothRows.map(([label, r, l]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{formatPercent(r, where)}</td>
              <td>{formatPercent(l, where)}</td>
            </tr>
          ))}
        </tbody>
        {showSizes && (
          <tbody>
            <tr>
              <th scope="col">
                Upper teeth, mm{' '}
                <span className="measurements__note">width × length, as seen from the front</span>
              </th>
              <th scope="col">Right (11–13)</th>
              <th scope="col">Left (21–23)</th>
            </tr>
            {sizeRows.map(([label, r, l]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{formatSize(r, where)}</td>
                <td>{formatSize(l, where)}</td>
              </tr>
            ))}
          </tbody>
        )}
      </table>
      {where === 'report' && basis && <p className="measurements__basis">{basis}</p>}
      {onDownload && (
        <p className="measurements__download no-print">
          <button type="button" onClick={onDownload} title="Download the measurements for the lab">
            CSV
          </button>
        </p>
      )}
    </section>
  );
}
