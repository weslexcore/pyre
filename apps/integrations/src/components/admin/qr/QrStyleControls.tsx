import {
  CORNER_DOT_TYPES,
  CORNER_SQUARE_TYPES,
  type CornerDotType,
  type CornerSquareType,
  DEFAULT_QR_STYLE,
  DOT_TYPES,
  type DotType,
  PYRE_COLORS,
  type QrStyle,
} from '@/lib/qr/style';
import { InfoTip } from '../InfoTip';

/** One-click Pyre brand-color swatches for a color field. */
function Swatches({ onPick }: { onPick: (hex: string) => void }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {PYRE_COLORS.map((c) => (
        <button
          key={c.hex}
          type="button"
          title={c.name}
          aria-label={c.name}
          onClick={() => onPick(c.hex)}
          style={{ backgroundColor: c.hex }}
          className="h-4 w-4 rounded-sm border border-white/25 transition-transform hover:scale-110"
        />
      ))}
    </div>
  );
}

/** Compact controls that mutate the shared QR style. */
export function QrStyleControls({
  style,
  onChange,
}: {
  style: QrStyle;
  onChange: (next: QrStyle) => void;
}) {
  const set = <K extends keyof QrStyle>(key: K, value: QrStyle[K]) =>
    onChange({ ...style, [key]: value });

  const selectClass =
    'w-full px-2 py-1.5 rounded bg-white/5 border border-white/10 text-xs text-[var(--pyre-creme)] focus:outline-none focus:border-white/30';
  const labelClass = 'text-[10px] font-mono-bold uppercase tracking-wide text-white/40 mb-1 block';

  return (
    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3 rounded border border-white/10 bg-white/5 p-3">
      <div>
        <span className={labelClass}>Dot color</span>
        <input
          type="color"
          value={style.dark}
          onChange={(e) => set('dark', e.target.value)}
          className="h-8 w-full rounded bg-transparent"
          aria-label="Dot color"
        />
        <Swatches onPick={(hex) => set('dark', hex)} />
      </div>
      <div>
        <span className={labelClass}>Background</span>
        <input
          type="color"
          value={style.light}
          onChange={(e) => set('light', e.target.value)}
          disabled={style.transparent}
          className="h-8 w-full rounded bg-transparent disabled:opacity-30"
          aria-label="Background color"
        />
        <Swatches onPick={(hex) => set('light', hex)} />
      </div>
      <div className="flex flex-col justify-end gap-1.5 pb-1.5">
        <label className="flex items-center gap-1.5 text-xs text-white/60">
          <input
            type="checkbox"
            checked={style.transparent}
            onChange={(e) => set('transparent', e.target.checked)}
          />
          Transparent bg
        </label>
        <label className="flex items-center gap-1.5 text-xs text-white/60">
          <input
            type="checkbox"
            checked={style.logo}
            onChange={(e) => set('logo', e.target.checked)}
          />
          Center logo
        </label>
      </div>
      <div>
        <span className={labelClass}>Dot shape</span>
        <select
          value={style.dotType}
          onChange={(e) => set('dotType', e.target.value as DotType)}
          className={selectClass}
          aria-label="Dot shape"
        >
          {DOT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div>
        <span className={labelClass}>Corner shape</span>
        <select
          value={style.cornerSquareType}
          onChange={(e) => set('cornerSquareType', e.target.value as CornerSquareType)}
          className={selectClass}
          aria-label="Corner shape"
        >
          {CORNER_SQUARE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div>
        <span className={labelClass}>Corner dot</span>
        <select
          value={style.cornerDotType}
          onChange={(e) => set('cornerDotType', e.target.value as CornerDotType)}
          className={selectClass}
          aria-label="Corner dot shape"
        >
          {CORNER_DOT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div>
        <span className={labelClass}>Size {style.size}px</span>
        <input
          type="range"
          min={120}
          max={600}
          step={20}
          value={style.size}
          onChange={(e) => set('size', Number(e.target.value))}
          className="w-full"
          aria-label="Size"
        />
      </div>
      <div>
        <span className={`${labelClass} flex items-center gap-1.5`}>
          Quiet zone {style.margin}
          <InfoTip
            label="quiet zone"
            text="The empty border around the code. Phone cameras use it to find the edges, so keep some when the code is printed small or sits on a busy background."
          />
        </span>
        <input
          type="range"
          min={0}
          max={40}
          step={1}
          value={style.margin}
          onChange={(e) => set('margin', Number(e.target.value))}
          className="w-full"
          aria-label="Quiet zone margin"
        />
      </div>
      <div className="flex items-end pb-0.5">
        <button
          type="button"
          onClick={() => onChange(DEFAULT_QR_STYLE)}
          className="text-[10px] font-mono-bold uppercase tracking-wide text-white/40 hover:text-white transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
