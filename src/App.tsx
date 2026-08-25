import { StepNav } from './features/StepNav.js';
import { useAppStore } from './state/store.js';

/**
 * Shell only. Each step's view lands in `features/<step>/` as it is built
 * (spec 14); until then the placeholder names the step so navigation and the
 * cascade rule can be exercised end to end.
 */
export function App() {
  const step = useAppStore((s) => s.step);

  return (
    <div className="app">
      <header className="app__header">
        <h1>Smile Design</h1>
        <StepNav />
      </header>
      <main className="app__main">
        <p className="placeholder">Step: {step}</p>
      </main>
    </div>
  );
}
