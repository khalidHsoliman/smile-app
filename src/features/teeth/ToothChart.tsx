import { useRef } from 'react';
import { archOf, toFDI, type Arch, type Universal } from '../../domain/teeth.js';
import { applyToothClick } from '../../domain/selection.js';
import { getTemplate } from '../../domain/templates/buildTemplate.js';
import { toothType } from '../../domain/templates/buildTemplate.js';
import { useAppStore } from '../../state/store.js';

/**
 * The dental chart.
 *
 * Drawn as an anatomical arch rather than a row of numbers: a clinician should
 * not have to know that Universal 8 is the upper right central to pick it. Each
 * tooth is the template's own outline, laid out in a horseshoe, so the chart
 * looks like the thing it represents.
 *
 * Laid out with universal 1-16 running left to right across the upper arch, so
 * the patient's right appears on the viewer's left exactly as in the photo.
 *
 * SVG, not a bitmap: it stays crisp at any size, inherits the theme, and the
 * teeth are the click targets themselves.
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
      <ArchDiagram arch="upper" teeth={UPPER} selected={selected} onClick={handleClick} />
      <ArchDiagram arch="lower" teeth={LOWER_DISPLAY} selected={selected} onClick={handleClick} />
      <p className="chart__hint">
        Click a tooth to toggle it · Shift-click to fill a range · Labels are FDI
      </p>
    </div>
  );
}

interface ArchDiagramProps {
  arch: Arch;
  teeth: Universal[];
  selected: Universal[];
  onClick: (tooth: Universal, extend: boolean) => void;
}

/** Chart geometry, in the diagram's own units. */
const ARCH_WIDTH = 17;
const ARCH_DEPTH = 3.0;
const TOOTH_SCALE = 1.15;

/**
 * One arch as a horseshoe.
 *
 * Teeth are placed along a parabola: nearly straight across the front six and
 * curving back sharply at the molars, which is what a real arch does and what
 * makes the diagram legible at a glance.
 */
function ArchDiagram({ arch, teeth, selected, onClick }: ArchDiagramProps) {
  // The chart always draws the template's own shapes, so the chart and the
  // design cannot drift apart visually.
  const template = getTemplate('natural');
  const chosen = new Set(selected.filter((t) => archOf(t) === arch));

  const placements = teeth.map((universal, index) => {
    // -1 at the patient's right molar, +1 at their left.
    const t = (index / (teeth.length - 1)) * 2 - 1;
    const x = t * (ARCH_WIDTH / 2);
    // Parabolic depth: 0 at the midline, deepest at the molars. The upper arch
    // opens downward and the lower upward, so they face each other.
    const depth = t * t * ARCH_DEPTH;
    const y = arch === 'upper' ? depth : -depth;
    // Teeth fan around the curve; the slope of the parabola gives the angle.
    const slope = (2 * t * ARCH_DEPTH) / (ARCH_WIDTH / 2);
    const angle =
      (Math.atan(slope) * 180) / Math.PI * (arch === 'upper' ? 1 : -1);

    return { universal, x, y, angle };
  });

  // Crowns extend ~1.4 units from the incisal line and labels sit beyond that,
  // so the box spans the arch depth plus room for both.
  const viewHeight = ARCH_DEPTH + 3.2;

  return (
    <div className="chart__arch">
      <span className="chart__label">{arch === 'upper' ? 'Upper' : 'Lower'}</span>
      <svg
        className="chart__svg"
        viewBox={`${-ARCH_WIDTH / 2 - 1} ${
          arch === 'upper' ? -2.0 : -viewHeight + 2.0
        } ${ARCH_WIDTH + 2} ${viewHeight}`}
        role="group"
        aria-label={`${arch} arch`}
      >
        {placements.map(({ universal, x, y, angle }) => {
          const tooth = template?.teeth[universal];
          const isChosen = chosen.has(universal);

          return (
            <g
              key={universal}
              className="chart__tooth"
              data-selected={isChosen || undefined}
              transform={`translate(${x} ${y}) rotate(${angle})`}
              role="checkbox"
              aria-checked={isChosen}
              aria-label={`Tooth ${toFDI(universal)}, universal ${universal}, ${toothType(universal)}`}
              tabIndex={0}
              onClick={(event) => onClick(universal, event.shiftKey)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onClick(universal, event.shiftKey);
                }
              }}
            >
              {tooth && (
                <path
                  className="chart__shape"
                  d={tooth.outline}
                  // Upper crowns point up from the incisal edge; lower point
                  // down. The outline is authored with +y toward the gum.
                  transform={`scale(${TOOTH_SCALE} ${
                    arch === 'upper' ? -TOOTH_SCALE : TOOTH_SCALE
                  })`}
                />
              )}
              <text
                className="chart__number"
                x={0}
                y={arch === 'upper' ? 0.95 : -0.45}
                textAnchor="middle"
              >
                {toFDI(universal)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
