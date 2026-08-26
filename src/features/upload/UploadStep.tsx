import { useEffect, useState } from 'react';
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
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Offered only when the photos are actually installed: a button that fails
  // is worse than no button. See `features/demo/demoCase`.
  useEffect(() => {
    let cancelled = false;
    void import('../demo/demoCase.js')
      .then((m) => m.demoCaseAvailable())
      .then((ok) => {
        if (!cancelled) setAvailable(ok);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="step step--upload">
      {!hasPhoto && available && (
        <div className="demo">
          <button
            type="button"
            className="demo__button"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              setError(null);
              void loadDemoCase()
                .catch((cause: Error) => setError(cause.message))
                .finally(() => setLoading(false));
            }}
          >
            {loading ? 'Loading…' : 'Load the demo case'}
          </button>
          <span className="demo__note">
            {error ?? 'A sample patient, for showing the workflow without an upload.'}
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
