import { useRef } from 'react';
import { archOf, toFDI, type Arch, type Universal } from '../../domain/teeth.js';
import { applyToothClick } from '../../domain/selection.js';
import { useAppStore } from '../../state/store.js';

/**
 * The dental chart (spec 3.3).
 *
 * Laid out anatomically: universal 1-16 runs left to right across the top, so
 * the patient's right side appears on the viewer's left, as it does in the
 * photograph. Shift-click fills the range from the last clicked tooth.
 */

const UPPER: Universal[] = Array.from({ length: 16 }, (_, i) => i + 1);
const LOWER: Universal[] = Array.from({ length: 16 }, (_, i) => i + 17);

/** Lower teeth ascend right-to-left, so reverse them to keep the midline centred. */
const LOWER_DISPLAY = [...LOWER].reverse();

export function ToothChart() {
  const selected = useAppStore((s) => s.selectedTeeth);
  const setSelectedTeeth = useAppStore((s) => s.setSelectedTeeth);

  // Anchor for range fill. A ref, not state: it never affects rendering.
  const anchor = useRef<Universal | undefined>(undefined);

  const handleClick = (tooth: Universal, extend: boolean) => {
    const result = applyToothClick(selected, tooth, {
      anchor: anchor.current,
      extend,
    });
    anchor.current = result.anchor;
    setSelectedTeeth(result.selected);
  };

  return (
    <div className="chart">
      <ArchRow label="Upper" arch="upper" teeth={UPPER} selected={selected} onClick={handleClick} />
      <ArchRow label="Lower" arch="lower" teeth={LOWER_DISPLAY} selected={selected} onClick={handleClick} />
      <p className="chart__hint">Click to toggle · Shift-click to fill a range</p>
    </div>
  );
}

interface ArchRowProps {
  label: string;
  arch: Arch;
  teeth: Universal[];
  selected: Universal[];
  onClick: (tooth: Universal, extend: boolean) => void;
}

function ArchRow({ label, arch, teeth, selected, onClick }: ArchRowProps) {
  const chosen = new Set(selected.filter((t) => archOf(t) === arch));

  return (
    <div className="chart__arch">
      <span className="chart__label">{label}</span>
      <div className="chart__row">
        {teeth.map((tooth) => (
          <button
            key={tooth}
            type="button"
            className="chart__tooth"
            aria-pressed={chosen.has(tooth)}
            title={`Universal ${tooth} · FDI ${toFDI(tooth)}`}
            onClick={(event) => onClick(tooth, event.shiftKey)}
          >
            {toFDI(tooth)}
          </button>
        ))}
      </div>
    </div>
  );
}
