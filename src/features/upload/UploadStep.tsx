import { useState } from 'react';
import { PhotoTile } from './PhotoTile.js';
import { ToothChart } from '../teeth/ToothChart.js';
import { useAppStore } from '../../state/store.js';

/**
 * The upload step: two photographs and the teeth of interest (spec 3).
 *
 * The step clears once a smile photo and at least one tooth are present; the
 * store owns that rule (`syncUploadGate`), not this component.
 */
export function UploadStep() {
  const loadDemoCase = useAppStore((s) => s.loadDemoCase);
  const hasPhoto = useAppStore((s) => s.photos.smile !== null);
  const [loading, setLoading] = useState(false);

  return (
    <div className="step step--upload">
      {!hasPhoto && (
        /*
          A way in without needing a patient. The images are drawn, not
          photographed: a photo licence comes from the photographer, but a real
          face also carries that person's own rights and, in a dental context,
          implies their health data. Nobody is depicted here.
        */
        <div className="demo">
          <button
            type="button"
            className="demo__button"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              void loadDemoCase().finally(() => setLoading(false));
            }}
          >
            {loading ? 'Preparing…' : 'Try the demo case'}
          </button>
          <span className="demo__note">
            An illustrated patient, not a photograph — no real person, no consent needed.
          </span>
        </div>
      )}

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
