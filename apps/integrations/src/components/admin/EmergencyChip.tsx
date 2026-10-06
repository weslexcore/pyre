// Marks time off — and the sub request that logged it — as an emergency (the
// person can't work it). Nothing short of an emergency is shown. Shared by the
// schedule board and the Availability sheet.

export function EmergencyChip({ emergency }: { emergency: boolean | null | undefined }) {
  if (!emergency) return null;
  return (
    <span
      className="rounded border border-[var(--pyre-red)]/60 bg-[var(--pyre-red)]/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-red)]"
      title="Marked an emergency — they can't work it"
    >
      Emergency
    </span>
  );
}

/** The opt-in checkbox for marking an emergency. */
export function EmergencyToggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 font-mono text-xs text-white/70">
      <input
        type="checkbox"
        className="h-4 w-4 accent-[var(--pyre-red)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      Emergency — I can't work it (illness, family emergency)
    </label>
  );
}
