// One KPI on a board's goal: the meter, the numbers behind it, and the
// inline "update value" that is the whole point of the row.
//
// Two levels of hands on it. Whoever can open the board may type in the
// measurement (canMeasure) — the community manager on the rental pipeline
// knows how many rentals were booked. Editing the definition or removing the
// KPI is reshaping the goal, which is the whole tool's (canManage).

import type { GoalKpiRow } from '@/lib/db';
import { formatKpiValue } from '@/lib/goals/kpis';
import { KPI_DIRECTION_LABELS } from '@/lib/goals/types';
import { buttonClass, KpiMeter } from '../goalsUi';
import { KpiMeasureForm } from './KpiMeasureForm';

export function KpiRow({
  kpi,
  nowIso,
  busy = false,
  canManage = false,
  canMeasure = false,
  onMeasure,
  onEdit,
  onRemove,
}: {
  kpi: GoalKpiRow;
  nowIso: string;
  busy?: boolean;
  canManage?: boolean;
  canMeasure?: boolean;
  onMeasure: (value: number | null) => Promise<void>;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="rounded border border-white/10 bg-white/[0.03] p-3">
      <KpiMeter kpi={kpi} nowIso={nowIso} />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-white/35">
          {KPI_DIRECTION_LABELS[kpi.direction]} {formatKpiValue(kpi.target_value, kpi.unit)}
          {kpi.start_value !== null && ` · from ${formatKpiValue(kpi.start_value, kpi.unit)}`}
        </span>
        {canManage && (
          <span className="flex gap-2">
            <button type="button" className={buttonClass} disabled={busy} onClick={onEdit}>
              Edit
            </button>
            <button type="button" className={buttonClass} disabled={busy} onClick={onRemove}>
              Remove
            </button>
          </span>
        )}
      </div>

      {canMeasure && (
        <div className="mt-2">
          <KpiMeasureForm kpi={kpi} busy={busy} onMeasure={onMeasure} />
        </div>
      )}
    </li>
  );
}
