// One guest (/admin/guests/[memberId]).
//
// Two sources, painted as each lands: our own profile (summary, answers,
// notes) from /api/admin/guests, and the Momence account (visits, purchases,
// session history) from /api/admin/guest-momence. Our side is fast and
// editable; Momence's is slower and read-only, with a Refresh for when a
// purchase just happened at the desk.
//
// A profile is created on first save rather than on first view, so opening
// a guest to have a look never leaves an empty row behind.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import { timeAgo } from '@/lib/client/relativeTime';
import type {
  GuestFieldValue,
  GuestProfileFieldRow,
  GuestProfileNoteRow,
  GuestProfileRow,
} from '@/lib/db';
import { habitLine, type PackSummary } from '@/lib/guests/insights';
import type { GuestMomenceSnapshot } from '@/lib/guests/momence';
import { FIELD_LIMITS, groupFields, hasAnswer } from '@/lib/guests/types';
import { actorLabel, type PeopleNames, sameActor } from '@/lib/sops/names';
import { ConfirmDialog } from './ConfirmDialog';
import { FieldRow, formatMonth, QuietBadge, StandingBadge, send } from './guestUi';
import {
  buttonClass,
  cardClass,
  formatDateTime,
  formatDayAndTime,
  inputClass,
  labelClass,
  primaryButtonClass,
  SectionTitle,
} from './incidentUi';

interface ProfileResponse {
  memberId: string;
  profile: GuestProfileRow | null;
  fields: GuestProfileFieldRow[];
  notes: GuestProfileNoteRow[];
  people: PeopleNames;
  canManage: boolean;
  isAdmin: boolean;
  self: string;
}

type Draft = { summary: string; values: Record<string, GuestFieldValue> };

function draftFrom(profile: GuestProfileRow | null): Draft {
  return {
    summary: profile?.summary ?? '',
    values: { ...(profile?.field_values ?? {}) },
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function packLine(pack: PackSummary): string {
  const bits: string[] = [];
  if (pack.creditsLeft !== null && pack.creditsTotal !== null) {
    bits.push(`${pack.creditsLeft} of ${pack.creditsTotal} left`);
  } else if (pack.moneyLeft !== null) {
    bits.push(`$${pack.moneyLeft} left`);
  }
  if (pack.frozen) bits.push('frozen');
  if (pack.endDate) bits.push(`until ${formatMonth(pack.endDate)}`);
  return bits.join(' · ');
}

export function GuestProfile({
  memberId,
  fallbackName,
  fallbackEmail,
}: {
  memberId: string;
  fallbackName: string;
  fallbackEmail: string;
}) {
  const profileUrl = `/api/admin/guests?memberId=${encodeURIComponent(memberId)}`;
  const ours = useCachedJson<ProfileResponse>(profileUrl);
  const [fresh, setFresh] = useState(false);
  const momence = useCachedJson<GuestMomenceSnapshot>(
    `/api/admin/guest-momence?memberId=${encodeURIComponent(memberId)}${fresh ? '&fresh=1' : ''}`,
    { maxAgeMs: 2 * 60_000 }
  );

  const profile = ours.data?.profile ?? null;
  const fields = useMemo(() => ours.data?.fields ?? [], [ours.data]);

  // The form's working copy. Re-seeded whenever the saved profile changes
  // (a save, a reload) unless the person is mid-edit.
  const [draft, setDraft] = useState<Draft>(() => draftFrom(null));
  const [seededFor, setSeededFor] = useState<string | null>(null);
  useEffect(() => {
    if (!ours.data) return;
    const key = profile ? `${profile.id}:${profile.updated_at}` : 'none';
    if (seededFor === key) return;
    setDraft(draftFrom(profile));
    setSeededFor(key);
  }, [ours.data, profile, seededFor]);

  const saved = useMemo(() => draftFrom(profile), [profile]);
  const dirty = !sameDraft(draft, saved);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const account = momence.data?.account ?? null;
  const displayName = account?.name || profile?.name || fallbackName || `Member ${memberId}`;
  const displayEmail = account?.email || profile?.email || fallbackEmail || '';

  const save = useCallback(async () => {
    if (!ours.data) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Every active field is sent, null for a cleared answer, so the
      // server's merge sees withdrawals as well as additions.
      const values: Record<string, GuestFieldValue | null> = {};
      for (const field of fields) {
        if (field.archived && !(field.key in draft.values)) continue;
        values[field.key] = hasAnswer(draft.values[field.key]) ? draft.values[field.key] : null;
      }
      if (profile) {
        const { profile: next } = await send<{ profile: GuestProfileRow }>(
          '/api/admin/guests',
          'PATCH',
          { id: profile.id, summary: draft.summary, values }
        );
        ours.setData((prev) => (prev ? { ...prev, profile: next } : prev));
      } else {
        const { profile: next } = await send<{ profile: GuestProfileRow }>(
          '/api/admin/guests',
          'POST',
          {
            memberId,
            name: displayName,
            email: displayEmail,
            summary: draft.summary,
            values,
          }
        );
        ours.setData((prev) => (prev ? { ...prev, profile: next } : prev));
      }
      invalidateJson('/api/admin/guests?');
      invalidateJson('/api/admin/guests');
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [ours, fields, draft, profile, memberId, displayName, displayEmail]);

  // --- Notes ---
  const [noteBody, setNoteBody] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<GuestProfileNoteRow | null>(null);

  const addNote = useCallback(async () => {
    if (!ours.data || !noteBody.trim()) return;
    setNoteBusy(true);
    setNoteError(null);
    try {
      let target = profile;
      // A note on a guest with no profile yet starts one — that is often
      // the first thing anyone writes down.
      if (!target) {
        const { profile: created } = await send<{ profile: GuestProfileRow }>(
          '/api/admin/guests',
          'POST',
          { memberId, name: displayName, email: displayEmail }
        );
        target = created;
      }
      const { note } = await send<{ note: GuestProfileNoteRow }>('/api/admin/guest-notes', 'POST', {
        profileId: target.id,
        body: noteBody.trim(),
      });
      const owner = target;
      ours.setData((prev) =>
        prev ? { ...prev, profile: prev.profile ?? owner, notes: [note, ...prev.notes] } : prev
      );
      setNoteBody('');
      invalidateJson('/api/admin/guests');
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : 'Could not save the note');
    } finally {
      setNoteBusy(false);
    }
  }, [ours, noteBody, profile, memberId, displayName, displayEmail]);

  const removeNote = useCallback(async () => {
    if (!deleting) return;
    setNoteBusy(true);
    try {
      await send(`/api/admin/guest-notes?id=${deleting.id}`, 'DELETE');
      const gone = deleting.id;
      ours.setData((prev) =>
        prev ? { ...prev, notes: prev.notes.filter((n) => n.id !== gone) } : prev
      );
      setDeleting(null);
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : 'Could not remove the note');
    } finally {
      setNoteBusy(false);
    }
  }, [deleting, ours]);

  const groups = useMemo(
    () => groupFields(fields, Object.keys(profile?.field_values ?? {})),
    [fields, profile]
  );

  const history = momence.data?.history ?? null;
  const habit = history ? habitLine(history) : null;
  const maxType = history ? Math.max(1, ...history.byType.map((t) => t.count)) : 1;

  return (
    <div className="space-y-6">
      {/* Header: who this is, and the Momence facts at a glance. */}
      <div className={cardClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-primary-semibold text-[var(--pyre-creme)]">
              {displayName}
            </h2>
            <p className="mt-0.5 truncate font-mono text-xs text-white/45">
              {displayEmail || 'No email on file'}
              {account?.phone ? ` · ${account.phone}` : ''}
            </p>
          </div>
          <a href="/admin/guests" className={buttonClass}>
            All guests
          </a>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {momence.data && <StandingBadge standing={momence.data.standing} />}
          {account && (
            <>
              <QuietBadge>
                {account.visitsAttended} visit{account.visitsAttended === 1 ? '' : 's'}
              </QuietBadge>
              <QuietBadge>Since {formatMonth(account.firstSeen)}</QuietBadge>
              {account.lastSeen && <QuietBadge>Last {formatMonth(account.lastSeen)}</QuietBadge>}
            </>
          )}
          {habit && <QuietBadge>{habit}</QuietBadge>}
          {account?.tags.map((tag) => (
            <QuietBadge key={tag}>{tag}</QuietBadge>
          ))}
          {momence.loading && (
            <span className="font-mono text-xs text-white/35">Asking Momence…</span>
          )}
          {momence.data?.errors.includes('account') && (
            <span className="text-xs text-[var(--pyre-gold)]">Momence account unavailable</span>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Left: what we know and can edit. */}
        <div className="space-y-6 lg:col-span-3">
          <section className={cardClass}>
            <SectionTitle note="The one line to read before greeting them. Shown on the roster.">
              In a sentence
            </SectionTitle>
            <textarea
              className={`${inputClass} min-h-[72px]`}
              maxLength={FIELD_LIMITS.summary}
              value={draft.summary}
              placeholder="Regular on Tuesday evenings, comes with her sister, likes it quiet."
              onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))}
            />
          </section>

          {ours.loading && <p className="font-mono text-xs text-white/40">Loading…</p>}
          {ours.error && (
            <p className="text-sm text-[var(--pyre-red)]">
              Couldn't load the profile: {ours.error}
            </p>
          )}

          {groups.map((group) => (
            <section key={group.section} className={cardClass}>
              <SectionTitle>{group.section}</SectionTitle>
              <div className="space-y-4">
                {group.fields.map((field) => (
                  <FieldRow
                    key={field.key}
                    field={field}
                    value={draft.values[field.key]}
                    onChange={(next) =>
                      setDraft((d) => {
                        const values = { ...d.values };
                        if (next === null) delete values[field.key];
                        else values[field.key] = next;
                        return { ...d, values };
                      })
                    }
                  />
                ))}
              </div>
            </section>
          ))}

          {ours.data && fields.length === 0 && (
            <div className={cardClass}>
              <p className="text-sm text-white/60">
                No profile fields are set up yet.
                {ours.data.canManage ? (
                  <>
                    {' '}
                    <a href="/admin/guests/fields" className="underline hover:text-white">
                      Add some
                    </a>
                    .
                  </>
                ) : (
                  ' Ask an admin to add some.'
                )}
              </p>
            </div>
          )}

          <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded border border-white/10 bg-[var(--pyre-black)]/95 p-3 backdrop-blur">
            <button
              type="button"
              className={primaryButtonClass}
              disabled={!dirty || saving || !ours.data}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : profile ? 'Save changes' : 'Start profile'}
            </button>
            {dirty && !saving && (
              <button
                type="button"
                className={buttonClass}
                onClick={() => setDraft(draftFrom(profile))}
              >
                Discard
              </button>
            )}
            {saveError && <span className="text-sm text-[var(--pyre-red)]">{saveError}</span>}
            {!dirty && profile && (
              <span className="font-mono text-xs text-white/35" title={profile.updated_at}>
                Saved {timeAgo(profile.updated_at)}
                {profile.updated_by && ours.data
                  ? ` by ${actorLabel(profile.updated_by, ours.data.self, ours.data.people)}`
                  : ''}
              </span>
            )}
          </div>

          <section className={cardClass}>
            <SectionTitle note="Anything that doesn't fit a field. Dated, with your name on it.">
              Notes
            </SectionTitle>
            <div className="space-y-2">
              <textarea
                className={`${inputClass} min-h-[72px]`}
                maxLength={FIELD_LIMITS.note}
                value={noteBody}
                placeholder="Loved the birch tonight. Asked about the founding membership."
                onChange={(e) => setNoteBody(e.target.value)}
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className={buttonClass}
                  disabled={noteBusy || !noteBody.trim() || !ours.data}
                  onClick={() => void addNote()}
                >
                  {noteBusy ? 'Saving…' : 'Add note'}
                </button>
                {noteError && <span className="text-sm text-[var(--pyre-red)]">{noteError}</span>}
              </div>
            </div>

            <ul className="mt-4 divide-y divide-white/5">
              {(ours.data?.notes ?? []).map((note) => {
                const mine = ours.data ? sameActor(note.author_email, ours.data.self) : false;
                return (
                  <li key={note.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/85">
                      {note.body}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wide text-white/35">
                      <span>
                        {ours.data
                          ? actorLabel(note.author_email, ours.data.self, ours.data.people)
                          : note.author_email}
                      </span>
                      <span title={note.created_at}>{formatDateTime(note.created_at)}</span>
                      {(mine || ours.data?.isAdmin) && (
                        <button
                          type="button"
                          className="underline hover:text-white"
                          onClick={() => setDeleting(note)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {ours.data && ours.data.notes.length === 0 && (
              <p className="mt-3 text-xs text-white/40">Nothing written down yet.</p>
            )}
          </section>
        </div>

        {/* Right: what Momence knows. */}
        <div className="space-y-6 lg:col-span-2">
          <section className={cardClass}>
            <div className="flex items-start justify-between gap-3">
              <SectionTitle note="Live from their account. Never edited here.">
                From Momence
              </SectionTitle>
              <button
                type="button"
                className={buttonClass}
                disabled={momence.loading || momence.refreshing}
                onClick={() => {
                  setFresh(true);
                  void momence.reload();
                }}
              >
                Refresh
              </button>
            </div>

            {momence.error && (
              <p className="text-sm text-[var(--pyre-red)]">
                Couldn't reach Momence: {momence.error}
              </p>
            )}

            <div className="space-y-5">
              <div>
                <h3 className={labelClass}>Memberships & packs</h3>
                {momence.data?.errors.includes('purchases') && (
                  <p className="text-xs text-[var(--pyre-gold)]">
                    Purchases unavailable right now.
                  </p>
                )}
                {momence.data && momence.data.activePacks.length === 0 && (
                  <p className="text-sm text-white/50">Nothing active — paying per session.</p>
                )}
                <ul className="space-y-1.5">
                  {(momence.data?.activePacks ?? []).map((pack, index) => (
                    <li key={`${pack.name}-${pack.startDate ?? index}`} className="text-sm">
                      <span className="text-[var(--pyre-creme)]">{pack.name}</span>
                      {packLine(pack) && (
                        <span className="ml-2 font-mono text-xs text-white/45">
                          {packLine(pack)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {momence.data?.purchaseHistory &&
                  momence.data.purchaseHistory.length > momence.data.activePacks.length && (
                    <details className="mt-2">
                      <summary className="cursor-pointer font-mono text-xs text-white/40 hover:text-white/70">
                        Everything they've bought ({momence.data.purchaseHistory.length})
                      </summary>
                      <ul className="mt-2 space-y-1">
                        {momence.data.purchaseHistory.map((pack, index) => (
                          <li
                            key={`${pack.name}-${pack.startDate ?? index}-h`}
                            className="flex justify-between gap-3 text-xs"
                          >
                            <span className="text-white/70">{pack.name}</span>
                            <span className="shrink-0 font-mono text-white/35">
                              {formatMonth(pack.startDate)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
              </div>

              <div>
                <h3 className={labelClass}>Sessions they come to</h3>
                {momence.data?.errors.includes('sessions') && (
                  <p className="text-xs text-[var(--pyre-gold)]">History unavailable right now.</p>
                )}
                {history && history.booked === 0 && (
                  <p className="text-sm text-white/50">No bookings on record.</p>
                )}
                {history && history.byType.length > 0 && (
                  <ul className="space-y-1.5">
                    {history.byType.map((row) => (
                      <li key={row.type} className="text-xs">
                        <div className="flex justify-between gap-3">
                          <span className="text-white/80">{row.type}</span>
                          <span className="font-mono text-white/40">{row.count}</span>
                        </div>
                        <div className="mt-1 h-1 rounded bg-white/5">
                          <div
                            className="h-1 rounded bg-[var(--pyre-gold)]/60"
                            style={{ width: `${Math.round((row.count / maxType) * 100)}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {history && (
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-white/35">
                    {history.attended} attended · {history.booked} booked
                    {habit ? ` · ${habit.toLowerCase()}` : ''}
                  </p>
                )}
              </div>

              {history && history.recent.length > 0 && (
                <div>
                  <h3 className={labelClass}>Recent</h3>
                  <ul className="space-y-1">
                    {history.recent.map((entry) => (
                      <li
                        key={`${entry.startsAt}-${entry.name}`}
                        className="flex justify-between gap-3 text-xs"
                      >
                        <span className="truncate text-white/70">{entry.name}</span>
                        <span className="shrink-0 font-mono text-white/35">
                          {formatDayAndTime(entry.startsAt)}
                          {Date.parse(entry.startsAt) > Date.now()
                            ? ' · upcoming'
                            : entry.checkedIn
                              ? ''
                              : ' · no-show'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {account && account.customerFields.length > 0 && (
                <div>
                  <h3 className={labelClass}>On their Momence record</h3>
                  <dl className="space-y-1 text-xs">
                    {account.customerFields.map((f) => (
                      <div key={f.label} className="flex justify-between gap-3">
                        <dt className="text-white/45">{f.label}</dt>
                        <dd className="text-right text-white/80">{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {momence.data && (
                <p className="font-mono text-[10px] text-white/25" title={momence.data.fetchedAt}>
                  Momence member #{memberId} · fetched {timeAgo(momence.data.fetchedAt)}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>

      {deleting && (
        <ConfirmDialog
          title="Remove this note?"
          body="It comes off the profile for everyone. There is no undo."
          confirmLabel="Remove"
          danger
          busy={noteBusy}
          onConfirm={() => void removeNote()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

export default GuestProfile;
