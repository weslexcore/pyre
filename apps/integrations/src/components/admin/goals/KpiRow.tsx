// One KPI on a goal page: the meter, the numbers behind it, and the inline
// "update value" that is the whole point of the row.
//
// Updating the measurement is one field and one button, deliberately apart
// from editing the KPI itself. The number is touched weekly; the target and
// the direction are set once. Putting them in the same form would mean
// re-reading the definition every time somebody wants to type "3".

import { type FormEvent, useState } from 'react';
import type { GoalKpiRow } from '@/lib/db';
import { formatKpiValue } from '@/lib/goals/kpis';
import { KPI_DIRECTION_LABELS } from '@/lib/goals/types';
import { buttonClass, inputBaseClass, KpiMeter } from '../goalsUi';

export function KpiRow({
  kpi,
  nowIso,
  busy = false,
  onMeasure,
  onEdit,
  onRemove,
}: {
  kpi: GoalKpiRow;
  nowIso: string;
  busy?: boolean;
  onMeasure: (value: number | null) => Promise<void>;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [value, setValue] = useState(kpi.current_value === null ? '' : String(kpi.current_value));
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await onMeasure(value.trim() === '' ? null : Number(value));
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="rounded border border-white/10 bg-white/[0.03] p-3">
      <KpiMeter kpi={kpi} nowIso={nowIso} />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-white/35">
          {KPI_DIRECTION_LABELS[kpi.direction]} {formatKpiValue(kpi.target_value, kpi.unit)}
          {kpi.start_value !== null && ` · from ${formatKpiValue(kpi.start_value, kpi.unit)}`}
        </span>
        <span className="flex gap-2">
          <button type="button" className={buttonClass} disabled={busy} onClick={onEdit}>
            Edit
          </button>
          <button type="button" className={buttonClass} disabled={busy} onClick={onRemove}>
            Remove
          </button>
        </span>
      </div>

      <form onSubmit={submit} className="mt-2 flex gap-2">
        <label className="sr-only" htmlFor={`kpi-value-${kpi.id}`}>
          Current value for {kpi.name}
        </label>
        <input
          id={`kpi-value-${kpi.id}`}
          className={`${inputBaseClass} w-28`}
          type="number"
          inputMode="decimal"
          step="any"
          placeholder="—"
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" className={buttonClass} disabled={busy || saving}>
          {saving ? 'Saving…' : 'Update value'}
        </button>
      </form>
    </li>
  );
}
