import { useAppStore } from '../../state/store.js';
import {
  DEFAULT_PALETTE,
  paletteFromBase,
  type ToothPalette,
} from '../../vision/sampleToothColor.js';

/**
 * Tooth shade control (spec 8.4).
 *
 * The palette is normally sampled from the photograph, but shade is part of the
 * patient conversation -- "what if we went a shade brighter?" -- so it has to be
 * adjustable, and the previous product let the user set it for the report
 * specifically.
 *
 * One colour and one brightness, not four colours. The four tones of a tooth
 * are not independent: the cervical third is a warmer, darker version of the
 * body and the incisal edge a cooler, translucent one. Exposing them separately
 * would let a user build a palette no real tooth has. Editing the base and
 * deriving the rest keeps every setting physically coherent.
 */
export function ShadePicker() {
  const palette = useAppStore((s) => s.design.palette);
  const sampled = useAppStore((s) => s.design.paletteSampled);
  const sampledPalette = useAppStore((s) => s.design.sampledPalette);
  const setPalette = useAppStore((s) => s.setPalette);

  const apply = (next: ToothPalette) => setPalette(next, true);

  return (
    <div className="palette">
      <div className="palette__row">
        <span className="slider__name">Tooth shade</span>
        <input
          type="color"
          className="palette__input"
          value={palette.base}
          aria-label="Tooth shade"
          onChange={(event) => apply(paletteFromBase(event.target.value))}
        />
      </div>

      <label className="slider palette__brightness">
        <span className="slider__name">Brightness</span>
        <input
          type="range"
          min={-40}
          max={40}
          step={1}
          value={brightnessOf(palette)}
          onChange={(event) =>
            apply(paletteFromBase(palette.base, Number(event.target.value)))
          }
        />
      </label>

      <span className="palette__swatches" aria-hidden="true">
        <i style={{ background: palette.cervical }} />
        <i style={{ background: palette.base }} />
        <i style={{ background: palette.highlight }} />
        <i style={{ background: palette.incisal }} />
      </span>

      <div className="palette__actions">
        {sampledPalette && (
          <button
            type="button"
            className="sliders__reset"
            onClick={() => setPalette(sampledPalette, false)}
          >
            Use photo colour
          </button>
        )}
        <button
          type="button"
          className="sliders__reset"
          onClick={() => setPalette(DEFAULT_PALETTE, true)}
        >
          Default
        </button>
      </div>

      <span className="slider__hint">
        {sampled
          ? 'Chosen by hand. Not a shade match — confirm against a physical guide.'
          : sampledPalette
            ? 'Approximated from this photo. Not a shade match.'
            : 'Default enamel — no usable sample from this photo.'}
      </span>
    </div>
  );
}

/**
 * Recover the brightness offset a palette was built with.
 *
 * The slider needs a value to show, and storing it separately would be a second
 * copy of the same truth (spec 9.1). The offset is the gap between the base and
 * the highlight, which `paletteFromBase` derives deterministically.
 */
function brightnessOf(palette: ToothPalette): number {
  const base = parseInt(palette.base.slice(1, 3), 16);
  const neutral = parseInt(DEFAULT_PALETTE.base.slice(1, 3), 16);
  return Math.max(-40, Math.min(40, base - neutral));
}
