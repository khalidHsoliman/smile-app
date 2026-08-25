import { StepNav } from './features/StepNav.js';
import { UploadStep } from './features/upload/UploadStep.js';
import { AnalysisStep } from './features/analysis/AnalysisStep.js';
import { DesignStep } from './features/design/DesignStep.js';
import { ReportStep } from './features/report/ReportStep.js';
import { useAppStore } from './state/store.js';

/**
 * Shell. Each step's view lands in `features/<step>/` as it is built (spec 14);
 * the remaining placeholders name the step so navigation and the cascade rule
 * can be exercised end to end.
 */
export function App() {
  const step = useAppStore((s) => s.step);

  return (
    <div className="app">
      <header className="app__header no-print">
        <h1>Smile Design</h1>
        <StepNav />
      </header>
      <main className="app__main">
        {step === 'upload' && <UploadStep />}
        {step === 'analysis' && <AnalysisStep />}
        {step === 'design' && <DesignStep />}
        {step === 'report' && <ReportStep />}
      </main>
    </div>
  );
}
