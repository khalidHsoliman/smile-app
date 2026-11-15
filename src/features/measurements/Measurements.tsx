import type { FacialReferences } from '../../domain/faceFrame.js';
import type { PlacedTooth } from '../../domain/fitting.js';
import type { Template } from '../../domain/templates/types.js';
import {
  dentalMidlineOffset,
  faceMeasurements,
  formatMidline,
  formatOffset,
  formatPercent,
  formatTilt,
  toothMeasurements,
  type Where,
} from '../../domain/measurements.js';

interface MeasurementsProps {
  refs: FacialReferences | null;
  /** The design as shown: the fit with the per-tooth edits applied. */
  teeth: readonly PlacedTooth[] | null;
  template: Template | undefined;
  /** The panel says why a value is "-"; the report shows a plain "-". */
  where: Where;
}

/**
 * The numbers a clinician reads off a design, shown in the Design step's panel
 * and in the report. One component for both, so the two cannot disagree.
 *
 * Everything is worked out and worded in `domain/measurements.ts`; this only
 * lays it out. Every row is always shown, with "-" when it cannot be worked out.
 */
export function Measurements({ refs, teeth, template, where }: MeasurementsProps) {
  const face = faceMeasurements(refs);
  const { right, left } = toothMeasurements(teeth, template);

  const toothRows = [
    ['Central width : length', right.centralWidthToLength, left.centralWidthToLength],
    ['Lateral / central', right.lateralToCentral, left.lateralToCentral],
    ['Canine / central', right.canineToCentral, left.canineToCentral],
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
              {formatOffset(dentalMidlineOffset(refs, teeth, template), where)}
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
      </table>
    </section>
  );
}
