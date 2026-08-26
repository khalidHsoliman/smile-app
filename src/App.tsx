import { StepNav } from './features/StepNav.js';
import { UploadStep } from './features/upload/UploadStep.js';
import { MatchingStep } from './features/matching/MatchingStep.js';
import { AnalysisStep } from './features/analysis/AnalysisStep.js';
import { DesignStep } from './features/design/DesignStep.js';
import { ReportStep } from './features/report/ReportStep.js';
import { useAppStore } from './state/store.js';
import { useAutosave, type SaveState } from './state/useAutosave.js';

/**
 * Shell. Each step's view lands in `features/<step>/` as it is built (spec 14);
 * the remaining placeholders name the step so navigation and the cascade rule
 * can be exercised end to end.
 */
export function App() {
  const step = useAppStore((s) => s.step);
  const clearCase = useAppStore((s) => s.clearCase);
  const { state: saveState, restored } = useAutosave();

  return (
    <div className="app">
      <header className="app__header no-print">
        <h1>Smile Design</h1>
        <StepNav />
        <div className="app__status">
          <SaveIndicator state={saveState} />
          <button
            type="button"
            className="app__new"
            onClick={() => {
              if (window.confirm('Discard this case and start a new one?')) {
                clearCase();
              }
            }}
          >
            New case
          </button>
        </div>
      </header>
      <main className="app__main">
        {!restored && <p className="placeholder">Loading your last case…</p>}
        {restored && step === 'upload' && <UploadStep />}
        {restored && step === 'matching' && <MatchingStep />}
        {restored && step === 'analysis' && <AnalysisStep />}
        {restored && step === 'design' && <DesignStep />}
        {restored && step === 'report' && <ReportStep />}
      </main>
    </div>
  );
}

/**
 * Save status.
 *
 * Worth showing rather than hiding: the photos are patient data and never leave
 * the device, so the clinician should be able to see that the work is held
 * locally -- and see immediately when it is not.
 */
function SaveIndicator({ state }: { state: SaveState }) {
  const LABEL: Record<SaveState, string> = {
    idle: '',
    saving: 'Saving…',
    saved: 'Saved on this device',
    failed: 'Not saved',
    unavailable: 'Not saved — storage unavailable',
  };

  if (!LABEL[state]) return null;
  return (
    <span className="app__save" data-state={state}>
      {LABEL[state]}
    </span>
  );
}
