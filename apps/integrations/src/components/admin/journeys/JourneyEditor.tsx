// /admin/journeys/[id]: one journey. The header holds the live switches (on /
// off, test mode — saved immediately); the tabs edit a local draft of the
// definition that is saved as one new revision. Saves are compare-and-swap on
// the revision, so a stale tab can't overwrite someone else's edit.

import { useEffect, useMemo, useState } from 'react';
import { confirmAction } from '@/components/admin/ConfirmDialog';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { SopDiff } from '@/components/admin/SopDiff';
import { Toggle } from '@/components/admin/Toggle';
import { sendJson } from '@/lib/client/api';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import { fmtDateTime } from '@/lib/client/format';
import type { JourneyDetailResponse, JourneyRevisionDto } from '@/lib/email/journeys/api-types';
import { definitionSchema, type JourneyDefinition } from '@/lib/email/journeys/schema';
import {
  badgeClass,
  buttonClass,
  compactInputClass,
  describeTrigger,
  goldButtonClass,
  pillClass,
  sectionHeading,
} from './journeyUi';
import { OverviewPanel } from './OverviewPanel';
import { PeoplePanel } from './PeoplePanel';
import { StepsPanel } from './StepsPanel';

type Tab = 'steps' | 'overview' | 'people' | 'history';

interface Draft {
  name: string;
  definition: JourneyDefinition;
}

export function JourneyEditor({ journeyId }: { journeyId: string }) {
  const url = `/api/admin/journeys/${journeyId}`;
  const { data, error, reload } = useCachedJson<JourneyDetailResponse>(url, { maxAgeMs: 5_000 });
  const [tab, setTab] = useState<Tab>('steps');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ message: string; issues?: string[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [flagBusy, setFlagBusy] = useState(false);
  const [note, setNote] = useState('');

  const journey = data?.journey ?? null;

  // Seed the draft from the server copy — and re-seed when a newer revision
  // arrives while nothing is being edited.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only when the server copy changes
  useEffect(() => {
    if (!journey?.definition) return;
    if (
      draft === null ||
      (baseRevision !== journey.revision && !isDirty(draft, journey.name, journey.definition))
    ) {
      setDraft({ name: journey.name, definition: journey.definition });
      setBaseRevision(journey.revision);
    }
  }, [journey?.revision, journey?.definition]);

  const dirty = !!(
    draft &&
    journey?.definition &&
    isDirty(draft, journey.name, journey.definition)
  );
  const issues = useMemo(() => {
    if (!draft) return [];
    const parsed = definitionSchema.safeParse(draft.definition);
    return parsed.success
      ? []
      : parsed.error.issues.map(
          (i) => `${i.path.join('.')}${i.path.length ? ': ' : ''}${i.message}`
        );
  }, [draft]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const savedStepKeys = useMemo(
    () => new Set(journey?.definition?.steps.map((s) => s.key) ?? []),
    [journey?.definition]
  );

  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (!data || !journey) return <p className="text-sm text-white/40">Loading journey...</p>;
  if (!journey.definition) {
    return (
      <ErrorBanner>
        This journey's saved definition is not valid ({journey.definitionError}). Restore an earlier
        revision from the database, or ask for it to be fixed.
      </ErrorBanner>
    );
  }
  if (!draft) return <p className="text-sm text-white/40">Loading journey...</p>;

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setNotice(null);
    try {
      // Plain fetch rather than sendJson: a 400 carries the list of problems.
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          definition: draft.definition,
          baseRevision,
          note,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        issues?: string[];
        rescheduled?: number;
        missingTags?: string[] | null;
      };
      if (!res.ok) {
        setSaveError({ message: body.error ?? `HTTP ${res.status}`, issues: body.issues });
        return;
      }
      setNote('');
      const bits = ['Saved.'];
      if (body.rescheduled)
        bits.push(`Re-timed ${body.rescheduled} people waiting on changed steps.`);
      if (body.missingTags?.length) {
        bits.push(`Momence has no tag named ${body.missingTags.join(', ')} yet - create it there.`);
      }
      setNotice(bits.join(' '));
      invalidateJson('/api/admin/journeys');
      setDraft(null);
      await reload();
    } catch (e) {
      setSaveError({ message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const setFlags = async (flags: { enabled?: boolean; testMode?: boolean; archived?: boolean }) => {
    if (flags.enabled) {
      const ok = await confirmAction({
        title: `Turn on ${journey.name}?`,
        body: journey.testMode
          ? 'Test mode is on: only whitelisted addresses will enter or receive email.'
          : 'Real customers will start entering this journey and receiving its emails.',
        confirmLabel: 'Turn on',
      });
      if (!ok) return;
    }
    if (flags.testMode === false) {
      const ok = await confirmAction({
        title: 'Leave test mode?',
        body: journey.enabled
          ? 'The journey is on: real customers will start entering it and receiving its emails.'
          : 'When you turn it on, real customers will enter it.',
        confirmLabel: 'Leave test mode',
        danger: journey.enabled,
      });
      if (!ok) return;
    }
    if (flags.archived) {
      const ok = await confirmAction({
        title: `Archive ${journey.name}?`,
        body: 'It is switched off and hidden from the list. People in it stay where they are.',
        confirmLabel: 'Archive',
        danger: true,
      });
      if (!ok) return;
    }
    setFlagBusy(true);
    setSaveError(null);
    try {
      const result = await sendJson<{ resumed: number }>(url, 'PATCH', flags);
      if (result.resumed > 0)
        setNotice(
          `Back on - ${result.resumed} people who came due while it was off will continue now.`
        );
      invalidateJson('/api/admin/journeys');
      await reload();
    } catch (e) {
      setSaveError({ message: e instanceof Error ? e.message : String(e) });
    } finally {
      setFlagBusy(false);
    }
  };

  const updateDefinition = (definition: JourneyDefinition) => setDraft({ ...draft, definition });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <a
            href="/admin/journeys"
            className="font-mono text-xs uppercase tracking-wide text-white/40 hover:text-white/70"
          >
            All journeys
          </a>
          <input
            className="mt-1 block w-full bg-transparent text-xl font-semibold text-[var(--pyre-creme)] focus:outline-none"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            aria-label="Journey name"
          />
          <p className="mt-0.5 text-xs text-white/50">
            {describeTrigger(draft.definition.trigger)} · {journey.stats.active} in it now ·{' '}
            {journey.stats.sent30d} emails in 30 days ·{' '}
            <span className="font-mono">{journey.id}</span> · revision {journey.revision}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-sm">
              <Toggle
                checked={journey.enabled}
                disabled={flagBusy || journey.archived}
                label={journey.enabled ? 'Pause journey' : 'Turn journey on'}
                onChange={(enabled) => void setFlags({ enabled })}
              />
              {journey.enabled ? 'On' : 'Off'}
            </span>
            <span className="flex items-center gap-2 text-sm">
              <Toggle
                checked={journey.testMode}
                disabled={flagBusy}
                label="Test mode"
                onChange={(testMode) => void setFlags({ testMode })}
              />
              Test mode
            </span>
          </div>
          {journey.testMode && (
            <p className="max-w-xs text-right text-[11px] text-white/40">
              Only {data.whitelist.length ? data.whitelist.join(', ') : 'whitelisted addresses'} can
              enter or receive.
            </p>
          )}
        </div>
      </div>

      {!data.journeyTemplateLive && (
        <ErrorBanner>
          The shared <span className="font-mono">journey</span> template is gated, so written emails
          only reach whitelisted addresses. Switch it live in{' '}
          <a href="/admin/email-templates" className="underline">
            Email Templates
          </a>
          .
        </ErrorBanner>
      )}
      {data.missingTags && data.missingTags.length > 0 && (
        <ErrorBanner>
          Momence has no tag named {data.missingTags.map((t) => `"${t}"`).join(', ')}. Create it in
          Momence (and any Price Rule that goes with it), or tag actions will be skipped.
        </ErrorBanner>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {(['steps', 'overview', 'people', 'history'] as Tab[]).map((t) => (
          <button key={t} type="button" className={pillClass(tab === t)} onClick={() => setTab(t)}>
            {t === 'people' ? `People (${journey.stats.active})` : t}
          </button>
        ))}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {dirty && <span className={badgeClass('test')}>unsaved</span>}
          {dirty && (
            <input
              className={`${compactInputClass} w-48`}
              placeholder="What changed (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
          {dirty && (
            <button
              type="button"
              className={buttonClass}
              onClick={() =>
                setDraft({
                  name: journey.name,
                  definition: journey.definition as JourneyDefinition,
                })
              }
            >
              Discard
            </button>
          )}
          <button
            type="button"
            className={goldButtonClass}
            onClick={() => void save()}
            disabled={!dirty || saving || issues.length > 0}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </span>
      </div>

      {notice && <p className="text-sm text-emerald-400">{notice}</p>}
      {saveError && (
        <ErrorBanner>
          {saveError.message}
          {saveError.issues && (
            <ul className="mt-1 list-disc pl-5">
              {saveError.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
        </ErrorBanner>
      )}
      {dirty && issues.length > 0 && (
        <ErrorBanner mono>
          Fix before saving:
          <ul className="mt-1 list-disc pl-5">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </ErrorBanner>
      )}

      {tab === 'steps' && (
        <StepsPanel
          journeyId={journey.id}
          definition={draft.definition}
          savedStepKeys={savedStepKeys}
          onChange={updateDefinition}
          tags={data.tags}
          viewerEmail={data.viewerEmail}
        />
      )}
      {tab === 'overview' && (
        <>
          <OverviewPanel
            journeyId={journey.id}
            definition={draft.definition}
            onChange={updateDefinition}
            tags={data.tags}
          />
          <div className="flex justify-end">
            <button
              type="button"
              className={buttonClass}
              onClick={() => void setFlags({ archived: !journey.archived })}
              disabled={flagBusy}
            >
              {journey.archived ? 'Unarchive journey' : 'Archive journey'}
            </button>
          </div>
        </>
      )}
      {tab === 'people' && (
        <PeoplePanel
          journeyId={journey.id}
          definition={draft.definition}
          testMode={journey.testMode}
        />
      )}
      {tab === 'history' && (
        <HistoryPanel
          revisions={data.revisions}
          onRestore={(rev) => {
            const parsed = definitionSchema.safeParse(rev.definition);
            if (!parsed.success) {
              setSaveError({
                message: 'That revision no longer validates and cannot be restored.',
              });
              return;
            }
            setDraft({ name: rev.name, definition: parsed.data });
            setTab('steps');
            setNotice(`Loaded revision ${rev.revision} into the editor. Save to make it current.`);
          }}
        />
      )}
    </div>
  );
}

function isDirty(draft: Draft, name: string, definition: JourneyDefinition): boolean {
  return draft.name !== name || JSON.stringify(draft.definition) !== JSON.stringify(definition);
}

function HistoryPanel({
  revisions,
  onRestore,
}: {
  revisions: JourneyRevisionDto[];
  onRestore: (rev: JourneyRevisionDto) => void;
}) {
  const [open, setOpen] = useState<number | null>(revisions[0]?.revision ?? null);
  return (
    <div className="flex flex-col gap-2">
      <p className={sectionHeading}>Every saved version</p>
      {revisions.map((rev, i) => {
        const previous = revisions[i + 1];
        return (
          <div key={rev.revision} className="rounded border border-white/10 bg-white/[0.03]">
            <button
              type="button"
              className="flex w-full flex-wrap items-center gap-3 px-3 py-2 text-left"
              onClick={() => setOpen(open === rev.revision ? null : rev.revision)}
            >
              <span className="font-mono text-xs text-white/50">#{rev.revision}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{rev.note || rev.name}</span>
              <span className="font-mono text-[11px] text-white/40">
                {rev.editedBy ?? 'unknown'} · {fmtDateTime(rev.createdAt)}
              </span>
            </button>
            {open === rev.revision && (
              <div className="border-t border-white/10 p-3">
                {previous ? (
                  <SopDiff
                    before={JSON.stringify(previous.definition, null, 2)}
                    after={JSON.stringify(rev.definition, null, 2)}
                    context={3}
                  />
                ) : (
                  <p className="text-xs text-white/40">The first version.</p>
                )}
                {i > 0 && (
                  <button
                    type="button"
                    className={`${buttonClass} mt-2`}
                    onClick={() => onRestore(rev)}
                  >
                    Load this version into the editor
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
