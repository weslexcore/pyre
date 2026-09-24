// A goal's KPIs, worked in place: the meters, a measurement typed straight
// into each, and — for whoever may reshape the goal — adding, editing, and
// removing them. The same list on the board the goal serves and on the
// goals overview, so a KPI behaves the same wherever it is touched.

import { useState } from 'react';
import type { GoalKpiRow } from '@/lib/db';
import { ConfirmDialog } from '../ConfirmDialog';
import { send } from '../goalsUi';
import { KpiForm } from './KpiForm';
import { KpiRow } from './KpiRow';

export function GoalKpis({
  goalId,
  kpis,
  nowIso,
  busy,
  canManage,
  canMeasure,
  mutate,
}: {
  goalId: string;
  kpis: GoalKpiRow[];
  nowIso: string;
  busy: boolean;
  /** Define, edit, and remove KPIs. */
  canManage: boolean;
  /** Type in a measurement. */
  canMeasure: boolean;
  /** Runs a write and reloads; rejects with the API's message. */
  mutate: (run: () => Promise<unknown>) => Promise<void>;
}) {
  const [kpiFormFor, setKpiFormFor] = useState<GoalKpiRow | 'new' | null>(null);
  const [removingKpi, setRemovingKpi] = useState<GoalKpiRow | null>(null);

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-wide text-white/35">KPIs</p>
        {canManage && kpiFormFor === null && (
          <button
            type="button"
            className="font-mono text-[11px] text-white/45 underline hover:text-white/70"
            onClick={() => setKpiFormFor('new')}
          >
            Add a KPI
          </button>
        )}
      </div>
      {kpis.length === 0 && kpiFormFor === null && (
        <p className="font-mono text-xs text-white/35">
          No KPIs yet. Without one, “met” is a feeling.
        </p>
      )}
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {kpis.map((kpi) => (
          <KpiRow
            key={kpi.id}
            kpi={kpi}
            nowIso={nowIso}
            busy={busy}
            canManage={canManage}
            canMeasure={canMeasure}
            onEdit={() => setKpiFormFor(kpi)}
            onRemove={() => setRemovingKpi(kpi)}
            onMeasure={(value) =>
              mutate(() =>
                send('/api/admin/goal-kpis', 'PATCH', { id: kpi.id, currentValue: value })
              )
            }
          />
        ))}
      </ul>
      {kpiFormFor !== null && (
        <div className="mt-2">
          <KpiForm
            kpi={kpiFormFor === 'new' ? undefined : kpiFormFor}
            busy={busy}
            onCancel={() => setKpiFormFor(null)}
            onSave={async (values) => {
              if (kpiFormFor === 'new') {
                await mutate(() => send('/api/admin/goal-kpis', 'POST', { goalId, ...values }));
              } else {
                await mutate(() =>
                  send('/api/admin/goal-kpis', 'PATCH', { id: kpiFormFor.id, ...values })
                );
              }
              setKpiFormFor(null);
            }}
          />
        </div>
      )}

      {removingKpi && (
        <ConfirmDialog
          title={`Remove “${removingKpi.name}”?`}
          body="The KPI and every measurement on it go with it. The goal keeps its tasks and its history."
          confirmLabel="Remove"
          danger
          busy={busy}
          onCancel={() => setRemovingKpi(null)}
          onConfirm={() => {
            const id = removingKpi.id;
            setRemovingKpi(null);
            void mutate(() => send(`/api/admin/goal-kpis?id=${id}`, 'DELETE'));
          }}
        />
      )}
    </div>
  );
}
