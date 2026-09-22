// Writing down what "met" means. A KPI is a name, a direction, a target, and
// — the field people skip and shouldn't — where it stood when the goal was
// written, so the meter measures the distance still to travel rather than
// flattering the goal on day one.

import { type FormEvent, useState } from 'react';
import type { GoalKpiRow } from '@/lib/db';
import type { KpiDirectionValue } from '@/lib/goals/types';
import {
  GOAL_LIMITS,
  KPI_DIRECTION_HINTS,
  KPI_DIRECTION_LABELS,
  KPI_DIRECTIONS,
} from '@/lib/goals/types';
import {
  buttonClass,
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  SectionTitle,
  selectClass,
} from '../goalsUi';

export function KpiForm({
  kpi,
  busy = false,
  onSave,
  onCancel,
}: {
  /** The KPI being edited, or undefined for a new one. */
  kpi?: GoalKpiRow;
  busy?: boolean;
  onSave: (values: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(kpi?.name ?? '');
  const [unit, setUnit] = useState(kpi?.unit ?? '');
  const [direction, setDirection] = useState<KpiDirectionValue>(kpi?.direction ?? 'at_least');
  const [startValue, setStartValue] = useState(
    kpi?.start_value === null || kpi?.start_value === undefined ? '' : String(kpi.start_value)
  );
  const [targetValue, setTargetValue] = useState(
    kpi?.target_value === undefined ? '' : String(kpi.target_value)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ name, unit: unit || null, direction, startValue, targetValue });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that KPI');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className={cardClass}>
      <SectionTitle>{kpi ? 'Edit KPI' : 'New KPI'}</SectionTitle>

      <div className="space-y-4">
        <div>
          <label className={labelClass} htmlFor="kpi-name">
            What are we measuring?
          </label>
          <input
            id="kpi-name"
            className={inputClass}
            type="text"
            maxLength={GOAL_LIMITS.kpiName}
            placeholder="Consecutive weeks without founder intervention"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="kpi-direction">
              Direction
            </label>
            <select
              id="kpi-direction"
              className={selectClass}
              value={direction}
              onChange={(e) => setDirection(e.target.value as KpiDirectionValue)}
            >
              {KPI_DIRECTIONS.map((option) => (
                <option key={option} value={option}>
                  {KPI_DIRECTION_LABELS[option]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-white/35">{KPI_DIRECTION_HINTS[direction]}</p>
          </div>

          <div>
            <label className={labelClass} htmlFor="kpi-unit">
              Unit
            </label>
            <input
              id="kpi-unit"
              className={inputClass}
              type="text"
              maxLength={GOAL_LIMITS.kpiUnit}
              placeholder="weeks, %, $, shifts"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="kpi-start">
              Where it stands today
            </label>
            <input
              id="kpi-start"
              className={inputClass}
              type="number"
              inputMode="decimal"
              step="any"
              value={startValue}
              onChange={(e) => setStartValue(e.target.value)}
            />
            <p className="mt-1 text-xs text-white/35">
              The baseline the meter measures from. Leave it blank if there isn’t one.
            </p>
          </div>

          <div>
            <label className={labelClass} htmlFor="kpi-target">
              Target
            </label>
            <input
              id="kpi-target"
              className={inputClass}
              type="number"
              inputMode="decimal"
              step="any"
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
            />
          </div>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-[var(--pyre-red)]">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={buttonClass} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className={primaryButtonClass}
          disabled={busy || saving || !name.trim() || targetValue.trim() === ''}
        >
          {saving ? 'Saving…' : kpi ? 'Save KPI' : 'Add KPI'}
        </button>
      </div>
    </form>
  );
}
