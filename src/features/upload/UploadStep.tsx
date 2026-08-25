import { PhotoTile } from './PhotoTile.js';
import { ToothChart } from '../teeth/ToothChart.js';

/**
 * The upload step: two photographs and the teeth of interest (spec 3).
 *
 * The step clears once a smile photo and at least one tooth are present; the
 * store owns that rule (`syncUploadGate`), not this component.
 */
export function UploadStep() {
  return (
    <div className="step step--upload">
      <div className="tiles">
        <PhotoTile
          kind="smile"
          title="Smile photo"
          hint="Drop a frontal smile photo, or click to browse"
        />
        <PhotoTile
          kind="retracted"
          title="Retracted photo"
          hint="Optional — with cheek retractors"
        />
      </div>
      <ToothChart />
    </div>
  );
}
