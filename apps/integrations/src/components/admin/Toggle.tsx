// An on/off switch, drawn the same on /admin/settings and the notification
// preferences panel.

export function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-40 ${
        checked
          ? 'border-[var(--pyre-gold)]/60 bg-[var(--pyre-gold)]/30'
          : 'border-white/20 bg-white/5'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 h-4.5 w-4.5 rounded-full transition-all ${
          checked ? 'left-5.5 bg-[var(--pyre-gold)]' : 'left-0.5 bg-white/50'
        }`}
      />
    </button>
  );
}
