// The inline "update value" field: one number and one button, deliberately
// apart from editing the KPI itself. The number is touched weekly; the
// target and the direction are set once. Shared by the KPI row on a board
// page and anywhere else a meter wants a way to type in this week's figure.

import { type FormEvent, useState } from 'react';
import type { GoalKpiRow } from '@/lib/db';
import { buttonClass, inputBaseClass } from '../goalsUi';

export function KpiMeasureForm({
  kpi,
  busy = false,
  onMeasure,
}: {
  kpi: Pick<GoalKpiRow, 'id' | 'name' | 'current_value'>;
  busy?: boolean;
  onMeasure: (value: number | null) => Promise<void>;
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
    <form onSubmit={submit} className="flex gap-2">
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
  );
}
