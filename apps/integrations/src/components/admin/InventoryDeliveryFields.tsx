// The reject part of receiving a delivery, shared by the stock screen's
// Receive and the Re-order tab's Received: how many were rejected and why
// (tick every reason that applies, and/or type one),
// and — when rejects from an earlier delivery of this item are still on site
// waiting for the driver — whether they went back with this one (ticked by
// default: the driver usually takes them when dropping the next load).
//
// Rejects never go into stock; they are recorded for the vendor credit and
// the Rejects tab's reject rate.

import { useEffect } from 'react';
import { labelClass } from '@/components/admin/ui';
import { useCachedJson } from '@/lib/client/cachedJson';
import { fmtShortDate } from '@/lib/client/format';
import { formatUnits, parseQuantity, type UnitNames } from '@/lib/inventory/rules';
import { type InventoryRejectRow, REJECT_REASONS } from '@/lib/inventory/types';
import { Chip } from './incidentUi';
import { QuantityStepper } from './inventoryUi';
import { compactInputClass } from './ui';

export const REJECTS_API = '/api/admin/inventory-rejects';

export interface DeliveryState {
  rejected: string;
  /** One-tap reasons ticked, in the order they were ticked. */
  reasons: string[];
  /** A typed reason, on top of (or instead of) the ticked ones. */
  otherReason: string;
  /** null until the held list has loaded (then every held reject is ticked). */
  pickupIds: string[] | null;
}

export const EMPTY_DELIVERY: DeliveryState = {
  rejected: '0',
  reasons: [],
  otherReason: '',
  pickupIds: null,
};

/** "0"/"" is none; otherwise a positive quantity, or null when invalid. */
export function rejectedUnits(state: DeliveryState): number | null {
  const raw = state.rejected.trim();
  if (raw === '' || Number(raw) === 0) return 0;
  return parseQuantity(raw);
}

/** Every reason given: the ticked ones, then the typed one. */
export function deliveryReasons(state: DeliveryState): string[] {
  const other = state.otherReason.trim();
  return other ? [...state.reasons, other] : state.reasons;
}

/** The delivery part of the receive request body. */
export function deliveryBody(state: DeliveryState) {
  const rejected = rejectedUnits(state) ?? 0;
  return {
    rejected,
    reasons: rejected > 0 ? deliveryReasons(state) : undefined,
    pickupIds: state.pickupIds ?? [],
  };
}

/** Whether the reject fields are complete enough to save. */
export function deliveryReady(state: DeliveryState): boolean {
  const rejected = rejectedUnits(state);
  return rejected != null && (rejected === 0 || deliveryReasons(state).length > 0);
}

export function DeliveryFields({
  idPrefix,
  itemId,
  unit,
  value,
  onChange,
}: {
  idPrefix: string;
  itemId: string;
  unit: UnitNames;
  value: DeliveryState;
  onChange: (next: DeliveryState) => void;
}) {
  const held = useCachedJson<{ held: InventoryRejectRow[] }>(`${REJECTS_API}?heldFor=${itemId}`);
  const heldRows = held.data?.held ?? [];

  // Once loaded, the held rejects start ticked: the driver normally takes
  // last week's rejects when dropping this week's delivery.
  useEffect(() => {
    if (held.data && value.pickupIds === null) {
      onChange({ ...value, pickupIds: held.data.held.map((r) => r.id) });
    }
  }, [held.data, value, onChange]);

  const rejected = rejectedUnits(value);
  const picked = new Set(value.pickupIds ?? []);

  return (
    <div className="mb-4 space-y-4 rounded border border-white/10 p-3">
      <div>
        <label htmlFor={`${idPrefix}-rejected`} className={labelClass}>
          Rejected — not kept
        </label>
        <QuantityStepper
          id={`${idPrefix}-rejected`}
          value={value.rejected}
          onChange={(rejected) => onChange({ ...value, rejected })}
          label="rejected"
          min={0}
        />
        {rejected != null && rejected > 0 && (
          <div className="mt-3">
            <span className={labelClass}>Why — pick all that apply</span>
            <div className="mb-2 flex flex-wrap gap-2">
              {REJECT_REASONS.map((r) => {
                const selected = value.reasons.includes(r);
                return (
                  <Chip
                    key={r}
                    selected={selected}
                    label={r}
                    onClick={() =>
                      onChange({
                        ...value,
                        reasons: selected
                          ? value.reasons.filter((x) => x !== r)
                          : [...value.reasons, r],
                      })
                    }
                  />
                );
              })}
            </div>
            <input
              value={value.otherReason}
              maxLength={120}
              onChange={(e) => onChange({ ...value, otherReason: e.target.value })}
              placeholder="Something else? Say why"
              aria-label="Another reason they were rejected"
              className={`${compactInputClass} w-full`}
            />
            <p className="mt-2 text-xs text-white/50">
              Set them aside in the returns bag for the driver to take back. They're logged for the
              vendor credit and won't be counted as stock.
            </p>
          </div>
        )}
      </div>

      {heldRows.length > 0 && (
        <fieldset>
          <legend className={labelClass}>Rejects waiting for pickup</legend>
          <ul className="space-y-1.5">
            {heldRows.map((r) => (
              <li key={r.id}>
                <label className="flex items-start gap-2 text-sm text-white/80">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={picked.has(r.id)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(r.id);
                      else next.delete(r.id);
                      onChange({ ...value, pickupIds: [...next] });
                    }}
                  />
                  <span>
                    {formatUnits(Number(r.rejected_qty), unit)} ({r.reasons.join(', ')}) from{' '}
                    {fmtShortDate(r.received_at)} — driver took them back
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </div>
  );
}
