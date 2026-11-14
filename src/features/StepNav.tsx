import { useAppStore, stepNavItems } from '../state/store.js';

const LABELS = {
  upload: 'Upload',
  matching: 'Matching',
  analysis: 'Facial Analysis',
  design: 'Design',
  report: 'Report',
} as const;

/**
 * Workflow navigation. Locked steps are genuinely unreachable -- the store
 * refuses the transition, so this is a display of state, not the enforcement
 * of it.
 */
export function StepNav() {
  const items = useAppStore(stepNavItems);
  const goToStep = useAppStore((s) => s.goToStep);

  return (
    <nav className="stepnav">
      {items.map(({ step, unlocked, current }) => (
        <button
          key={step}
          className="stepnav__step"
          onClick={() => goToStep(step)}
          disabled={!unlocked}
          aria-current={current ? 'step' : undefined}
        >
          {LABELS[step]}
        </button>
      ))}
    </nav>
  );
}
