// The "what reaches my inbox" panel on /admin/notifications: one switch per
// kind of notification this person can receive. Delivery is opt-out — every
// switch starts on — and switching a kind off only stops new ones; what is
// already in the inbox stays. Each flip is applied at once and saved through
// /api/admin/notification-prefs; a failed save puts the switch back.

import { useState } from 'react';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { readError } from '@/lib/client/api';
import { useCachedJson } from '@/lib/client/cachedJson';
import type { NotificationKind } from '@/lib/db';
import { type NotificationKindOption, normalizeMutedKinds } from '@/lib/notifications/types';
import { Toggle } from './Toggle';

export const PREFS_URL = '/api/admin/notification-prefs';

export interface PrefsResponse {
  muted: NotificationKind[];
  kinds: NotificationKindOption[];
}

export function NotificationPreferences() {
  const prefs = useCachedJson<PrefsResponse>(PREFS_URL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const muted = new Set(prefs.data?.muted ?? []);

  const save = async (next: NotificationKind[]) => {
    const previous = prefs.data?.muted ?? [];
    setSaving(true);
    setError(null);
    prefs.setData((prev) => (prev ? { ...prev, muted: next } : prev));
    try {
      const res = await fetch(PREFS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ muted: next }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const { muted: saved } = (await res.json()) as { muted: NotificationKind[] };
      prefs.setData((prev) => (prev ? { ...prev, muted: saved } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
      prefs.setData((prev) => (prev ? { ...prev, muted: previous } : prev));
    } finally {
      setSaving(false);
    }
  };

  const flip = (kind: NotificationKind, on: boolean) => {
    const next = new Set(muted);
    if (on) next.delete(kind);
    else next.add(kind);
    void save(normalizeMutedKinds([...next]));
  };

  const offCount = muted.size;

  return (
    <section
      aria-labelledby="notification-prefs-heading"
      className="space-y-3 rounded border border-white/10 p-4"
    >
      <div>
        <h2
          id="notification-prefs-heading"
          className="font-mono text-xs uppercase tracking-wide text-white/70"
        >
          What reaches your inbox
        </h2>
        <p className="mt-1 text-sm text-white/50">
          Switch off the kinds you don't need. Only new notifications are affected — anything
          already here stays until you clear it.
          {offCount > 0 && ` ${offCount} switched off.`}
        </p>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}
      {prefs.error && !prefs.data && (
        <p role="alert" className="text-sm text-[var(--pyre-red)]">
          Couldn't load your preferences: {prefs.error}
        </p>
      )}

      {prefs.loading ? (
        <p className="py-4 text-center text-sm text-white/40">Loading…</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {(prefs.data?.kinds ?? []).map((option) => {
            const on = option.required || !muted.has(option.kind);
            return (
              <li key={option.kind} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-[var(--pyre-creme)]">
                    {option.label}
                    {option.required && (
                      <span className="ml-2 font-mono text-[10px] font-normal uppercase tracking-wide text-white/40">
                        Always on
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-white/50">{option.description}</p>
                </div>
                <Toggle
                  checked={on}
                  disabled={option.required || saving}
                  label={`${option.label} notifications`}
                  onChange={(next) => flip(option.kind, next)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
