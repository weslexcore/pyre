// One incident report (/admin/incidents/[id]) — the record itself, its
// media, and everything that has happened to it since.
//
// The page is read-first: what happened, to whom, what staff did, in the
// order a reviewer (or an insurer, or a lawyer) would want it. Editing is
// deliberately narrow. The original account belongs to the person who filed
// it, so only a reviewer — or the reporter inside their first hour — can
// correct the facts, and every correction is recorded with before/after in
// the trail at the bottom. Everyone who can see the report can append a
// follow-up note, which is the right way to add something later.
//
// The API is the security boundary; this island mirrors its rules so the UI
// doesn't offer buttons that would come back 403.
//
// A follow-up note can @-mention anyone who can open the report (the
// response's mentionPeople); notes draw their mentions as names.
//
// The report is read through the shared JSON cache, so coming back to it
// paints at once; every change shows the moment it is made (the record's
// fields are guessed from what was sent, the trail entry the server writes
// for it arrives with the revalidation behind the paint), and every
// successful change drops the cached /admin/incidents entries, so the log
// can never repaint a pre-edit snapshot of this report.

import { useMemo, useState } from 'react';
import { confirmAction } from '@/components/admin/ConfirmDialog';
import { formButtonClass } from '@/components/admin/ui';
import { readError } from '@/lib/client/api';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import { optimistic, tempId } from '@/lib/client/optimistic';
import type { IncidentAttachmentRow, IncidentEventRow, IncidentRow } from '@/lib/db';
import {
  ACCEPT_ATTRIBUTE,
  checkFile,
  downscaleImage,
  formatBytes,
  MAX_ATTACHMENTS_PER_INCIDENT,
} from '@/lib/incidents/media';
import {
  type AffectedPerson,
  AREA_LABELS,
  areaLabel,
  CATEGORY_OPTIONS,
  categoryLabel,
  factorLabel,
  INCIDENT_AREAS,
  type IncidentStatus,
  personRoleLabel,
  SEVERITY_OPTIONS,
  statusLabel,
  type Witness,
} from '@/lib/incidents/types';
import { FIELD_LIMITS } from '@/lib/incidents/validate';
import { type MentionPerson, namesOf } from '@/lib/mentions';
import { type PeopleNames, personName } from '@/lib/sops/names';
import {
  cardClass,
  formatDateTime,
  inputClass,
  labelClass,
  primaryButtonClass,
  SectionTitle,
  SeverityBadge,
  StatusBadge,
} from './incidentUi';
import { MentionedText } from './Mentions';
import { MentionTextarea } from './MentionTextarea';

interface DetailResponse {
  incident: IncidentRow;
  attachments: IncidentAttachmentRow[];
  events: IncidentEventRow[];
  people: PeopleNames;
  /** Who a follow-up note may @-mention: the report's readers. */
  mentionPeople?: MentionPerson[];
  canManage: boolean;
  canAmend: boolean;
  self: string;
}

// Where a reviewer moves the report next. Voiding is kept off the main row —
// it retires a report and is not part of the normal path.
const NEXT_STATUSES: { value: IncidentStatus; label: string }[] = [
  { value: 'under_review', label: 'Reviewing' },
  { value: 'action_required', label: 'Action required' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

/** The body's camelCase keys are the record's snake_case columns (lib/incidents/validate). */
function columnOf(key: string): string {
  return key.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}

/**
 * What the record will read once `body` is saved: the fields it names, in
 * column form, plus the status for a status change. Keys the record does
 * not have (the action word, say) are left out.
 */
function guessIncident(incident: IncidentRow, body: Record<string, unknown>): IncidentRow {
  const next: Record<string, unknown> = { ...incident };
  for (const [key, value] of Object.entries(body)) {
    if (key === 'action' || key === 'note') continue;
    const column = key === 'status' ? 'status' : columnOf(key);
    if (column in incident) next[column] = value;
  }
  return next as unknown as IncidentRow;
}

/** Where the trail puts a new entry: it keeps the server's order, whichever way that runs. */
function withEvent(events: IncidentEventRow[], event: IncidentEventRow): IncidentEventRow[] {
  const newestFirst =
    events.length > 1 && events[0].created_at > events[events.length - 1].created_at;
  return newestFirst ? [event, ...events] : [...events, event];
}

export function IncidentDetail({
  incidentId,
  uploadsFailed,
}: {
  incidentId: string;
  uploadsFailed: boolean;
}) {
  const {
    data,
    error: loadError,
    loading,
    reload,
    setData,
  } = useCachedJson<DetailResponse>(`/api/admin/incidents?id=${encodeURIComponent(incidentId)}`);
  const [actionError, setError] = useState<string | null>(null);
  const error = actionError ?? loadError;
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const mentionPeople = data?.mentionPeople ?? [];
  // The candidates' names too, so a note still on its way draws its
  // mentions as names before the server's directory arrives.
  const mentionNames = useMemo(
    () => ({ ...namesOf(mentionPeople), ...(data?.people ?? {}) }),
    [mentionPeople, data?.people]
  );

  /**
   * Save a change the page already shows. The record's fields are guessed
   * from the body; a follow-up note joins the trail under a temporary entry.
   * The trail entry the server writes for the change comes with the
   * revalidation after the save (the log's cached pages are dropped at the
   * same time, so it can never repaint a pre-edit snapshot). A refusal puts
   * the record back and says why.
   */
  const mutate = async (body: Record<string, unknown>) => {
    setError(null);
    const ok = await optimistic(
      setData,
      (prev) => {
        if (!prev) return prev;
        const events =
          body.action === 'note' && typeof body.note === 'string'
            ? withEvent(prev.events, {
                id: tempId(),
                incident_id: incidentId,
                action: 'note_added',
                actor: prev.self,
                detail: {},
                note: body.note,
                created_at: new Date().toISOString(),
              })
            : prev.events;
        return { ...prev, incident: guessIncident(prev.incident, body), events };
      },
      async () => {
        const res = await fetch('/api/admin/incidents', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: incidentId, ...body }),
        });
        if (!res.ok) throw new Error(await readError(res));
        invalidateJson('/api/admin/incidents');
        void reload();
        return true;
      },
      { onError: (message) => setError(message || 'That did not save') }
    );
    return ok === true;
  };

  if (loading) return <p className="font-mono text-xs text-white/40">Loading…</p>;

  if (!data) {
    return (
      <p className="rounded border border-[var(--pyre-red)]/50 bg-[var(--pyre-red)]/10 px-3 py-2 text-sm text-[var(--pyre-red)]">
        {error ?? 'Report not found.'}
      </p>
    );
  }

  const { incident, attachments, events, people, canManage, canAmend } = data;
  const affected = incident.affected_people as AffectedPerson[];
  const witnesses = incident.witnesses as Witness[];

  return (
    <div className="space-y-6">
      {uploadsFailed && (
        <p className="rounded border border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 px-3 py-2 text-sm text-[var(--pyre-gold)]">
          The report saved, but at least one photo didn't upload. Add them again below.
        </p>
      )}

      <header className={cardClass}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-white/50">{incident.reference}</span>
          <SeverityBadge severity={incident.severity} />
          <StatusBadge status={incident.status} />
          {incident.follow_up_required && (
            <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]">
              follow-up needed
            </span>
          )}
        </div>

        <h2 className="mt-2 text-xl font-primary-semibold text-[var(--pyre-creme)]">
          {categoryLabel(incident.category)} — {areaLabel(incident.area)}
        </h2>
        {incident.area_detail && <p className="text-sm text-white/60">{incident.area_detail}</p>}

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
          <Row label="Occurred">{formatDateTime(incident.occurred_at)}</Row>
          <Row label="Reported">
            {formatDateTime(incident.reported_at)} by {personName(incident.reported_by, people)}
          </Row>
          {incident.discovered_at && (
            <Row label="Discovered">{formatDateTime(incident.discovered_at)}</Row>
          )}
          {incident.reviewed_by && (
            <Row label="First reviewed">
              {formatDateTime(incident.reviewed_at)} by {personName(incident.reviewed_by, people)}
            </Row>
          )}
          {incident.resolved_by && (
            <Row label="Closed out">
              {formatDateTime(incident.resolved_at)} by {personName(incident.resolved_by, people)}
            </Row>
          )}
        </dl>
      </header>

      {canManage && (
        <div className={cardClass}>
          <SectionTitle note="Where this report stands. Every change is stamped with your name and the time.">
            Review
          </SectionTitle>
          <div className="flex flex-wrap gap-2">
            {NEXT_STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                disabled={incident.status === s.value}
                className={`${formButtonClass} ${incident.status === s.value ? 'border-[var(--pyre-gold)]/60 text-[var(--pyre-gold)]' : ''}`}
                onClick={() => void mutate({ action: 'status', status: s.value })}
              >
                {s.label}
              </button>
            ))}
            <button
              type="button"
              disabled={incident.status === 'voided'}
              className={`${formButtonClass} ml-auto`}
              title="Retire a duplicate or mistaken report. The text stays readable in the record."
              onClick={async () => {
                if (
                  await confirmAction({
                    title: 'Void this report?',
                    body: 'It stays in the log, marked as voided.',
                    confirmLabel: 'Void',
                    danger: true,
                  })
                ) {
                  void mutate({ action: 'status', status: 'voided' });
                }
              }}
            >
              Void
            </button>
          </div>
        </div>
      )}

      {editing && (canManage || canAmend) ? (
        <EditPanel
          incident={incident}
          canManage={canManage}
          onCancel={() => setEditing(false)}
          onSave={async (changes) => {
            // The corrections show at once; a refusal reopens the form.
            setEditing(false);
            const ok = await mutate(changes);
            if (!ok) setEditing(true);
          }}
        />
      ) : (
        <>
          <section className={cardClass}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <SectionTitle>What happened</SectionTitle>
              {(canManage || canAmend) && (
                <button type="button" className={formButtonClass} onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/85">
              {incident.description}
            </p>

            <p className="mt-5 mb-1 font-mono text-xs uppercase tracking-wide text-white/40">
              What staff did
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/85">
              {incident.immediate_actions}
            </p>
          </section>

          <section className={cardClass}>
            <SectionTitle>Response</SectionTitle>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
              <Row label="First aid">
                {incident.first_aid_given
                  ? `Yes${incident.first_aid_by ? ` — ${incident.first_aid_by}` : ''}`
                  : 'No'}
              </Row>
              <Row label="911 / EMS">
                {incident.ems_called
                  ? `Called${incident.ems_called_at ? ` at ${formatDateTime(incident.ems_called_at)}` : ''}`
                  : 'Not called'}
              </Row>
              <Row label="Police">{incident.police_called ? 'Called' : 'Not called'}</Row>
              <Row label="Hospital / urgent care">
                {incident.transported_to_hospital ? 'Went' : 'Did not go'}
              </Row>
              <Row label="Treatment refused">{incident.treatment_refused ? 'Yes' : 'No'}</Row>
              <Row label="Left the site">{yesNoUnknown(incident.guest_left_premises)}</Row>
              <Row label="Knows a report was filed">
                {yesNoUnknown(incident.guest_informed_of_report)}
              </Row>
            </dl>
          </section>
        </>
      )}

      {affected.length > 0 && (
        <section className={cardClass}>
          <SectionTitle>People involved</SectionTitle>
          <ul className="space-y-3">
            {affected.map((person, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: stored as a positional list
              <li key={i} className="border-b border-white/5 pb-3 last:border-0 last:pb-0">
                <p className="text-sm text-[var(--pyre-creme)]">
                  {person.name || 'Name not recorded'}{' '}
                  <span className="font-mono text-xs text-white/40">
                    · {personRoleLabel(person.role)}
                  </span>
                </p>
                {(person.phone || person.email || person.memberId) && (
                  <p className="mt-0.5 font-mono text-xs text-white/50">
                    {[person.phone, person.email, person.memberId && `member ${person.memberId}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
                {person.injured && (
                  <p className="mt-1 text-sm text-[var(--pyre-red)]">
                    Injured{person.injuryNature ? `: ${person.injuryNature}` : ''}
                    {person.bodyParts.length > 0 && ` (${person.bodyParts.join(', ')})`}
                  </p>
                )}
                {person.notes && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-white/60">{person.notes}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {witnesses.length > 0 && (
        <section className={cardClass}>
          <SectionTitle>Witnesses</SectionTitle>
          <ul className="space-y-3">
            {witnesses.map((witness, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: stored as a positional list
              <li key={i} className="border-b border-white/5 pb-3 last:border-0 last:pb-0">
                <p className="text-sm text-[var(--pyre-creme)]">
                  {witness.name || 'Name not recorded'}{' '}
                  <span className="font-mono text-xs text-white/40">
                    · {personRoleLabel(witness.role)}
                  </span>
                </p>
                {(witness.phone || witness.email || witness.memberId) && (
                  <p className="mt-0.5 font-mono text-xs text-white/50">
                    {[
                      witness.phone,
                      witness.email,
                      witness.memberId && `member ${witness.memberId}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
                {witness.statement && (
                  <p className="mt-1 whitespace-pre-wrap border-l-2 border-white/15 pl-3 text-sm italic text-white/70">
                    {witness.statement}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={cardClass}>
        <SectionTitle>Conditions</SectionTitle>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
          <Row label="Contributing factors">
            {incident.contributing_factors.length > 0
              ? incident.contributing_factors.map(factorLabel).join(', ')
              : 'None recorded'}
          </Row>
          <Row label="Equipment">{incident.equipment_involved || '—'}</Row>
          <Row label="Sauna temp">
            {incident.sauna_temp_f == null ? '—' : `${incident.sauna_temp_f}°F`}
          </Row>
          <Row label="Water temp">
            {incident.water_temp_f == null ? '—' : `${incident.water_temp_f}°F`}
          </Row>
          <Row label="Staff on shift">
            {incident.staff_present.length > 0 ? incident.staff_present.join(', ') : '—'}
          </Row>
        </dl>
      </section>

      <AttachmentPanel
        incidentId={incidentId}
        attachments={attachments}
        canAdd={canManage || canAmend}
        canManage={canManage}
        self={data.self}
        people={people}
        onChanged={reload}
        onRemoved={(id) =>
          setData((prev) =>
            prev ? { ...prev, attachments: prev.attachments.filter((a) => a.id !== id) } : prev
          )
        }
      />

      {(incident.follow_up_required ||
        incident.follow_up_notes ||
        incident.corrective_actions ||
        incident.resolution_notes ||
        canManage) && (
        <section className={cardClass}>
          <SectionTitle
            note={canManage ? 'What is being done about it, and what closed it out.' : undefined}
          >
            Follow-up
          </SectionTitle>
          {canManage ? (
            <ReviewFields incident={incident} onSave={mutate} />
          ) : (
            <dl className="grid grid-cols-1 gap-y-1.5">
              <Row label="Follow-up needed">{incident.follow_up_required ? 'Yes' : 'No'}</Row>
              {incident.follow_up_notes && <Row label="Notes">{incident.follow_up_notes}</Row>}
              {incident.corrective_actions && (
                <Row label="Corrective actions">{incident.corrective_actions}</Row>
              )}
              {incident.resolution_notes && (
                <Row label="Resolution">{incident.resolution_notes}</Row>
              )}
            </dl>
          )}
        </section>
      )}

      <section className={cardClass}>
        <SectionTitle note="Everything that has happened to this report, in order. Nothing here can be edited or removed.">
          Record
        </SectionTitle>

        <ol className="space-y-3">
          {events.map((event) => (
            <li key={event.id} className="border-l-2 border-white/10 pl-3">
              <p className="font-mono text-[10px] uppercase tracking-wide text-white/35">
                {formatDateTime(event.created_at)} · {actorName(event.actor, people)}
              </p>
              <p className="text-sm text-white/80">{describeEvent(event, people)}</p>
              {event.note && (
                <p className="mt-1 whitespace-pre-wrap text-sm text-white/65">
                  <MentionedText text={event.note} names={mentionNames} />
                </p>
              )}
            </li>
          ))}
        </ol>

        <div className="mt-4">
          <label className={labelClass} htmlFor="incident-follow-up">
            Add a follow-up note
          </label>
          <MentionTextarea
            id="incident-follow-up"
            className={`${inputClass} min-h-[80px]`}
            placeholder="Called the guest the next morning — they saw a doctor, no fracture, and they're coming back Saturday. Type @ to mention a reviewer."
            maxLength={FIELD_LIMITS.note}
            value={note}
            onChange={setNote}
            people={mentionPeople}
          />
          <button
            type="button"
            className={`${primaryButtonClass} mt-2`}
            disabled={!note.trim()}
            onClick={async () => {
              // The note joins the trail at once; a refusal hands it back.
              const text = note;
              setNote('');
              const ok = await mutate({ action: 'note', note: text });
              if (!ok) setNote(text);
            }}
          >
            Add note
          </button>
        </div>
      </section>

      {error && (
        <p className="rounded border border-[var(--pyre-red)]/50 bg-[var(--pyre-red)]/10 px-3 py-2 text-sm text-[var(--pyre-red)]">
          {error}
        </p>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-wide text-white/35">{label}</dt>
      <dd className="whitespace-pre-wrap text-sm text-white/80">{children}</dd>
    </div>
  );
}

const yesNoUnknown = (value: boolean | null): string =>
  value === null ? 'Not recorded' : value ? 'Yes' : 'No';

/**
 * The audit trail records 'system' for automated steps alongside real session
 * emails, so it gets its own label rather than personName()'s local-part
 * fallback ("system" would otherwise read fine, but the intent is explicit).
 */
function actorName(actor: string, people: PeopleNames): string {
  if (actor === 'system' || actor === 'cron') return 'Pyre system';
  return personName(actor, people);
}

/** One audit line, in a sentence rather than a field dump. */
function describeEvent(event: IncidentEventRow, people: PeopleNames): string {
  switch (event.action) {
    case 'created':
      return 'Report filed';
    case 'status_changed': {
      const change = event.detail.status as { from?: string; to?: string } | undefined;
      return change?.to
        ? `Status changed from ${statusLabel(change.from ?? '')} to ${statusLabel(change.to)}`
        : 'Status changed';
    }
    case 'updated': {
      const fields = Object.keys(event.detail);
      return `Edited ${fields.length === 0 ? 'the report' : fields.map(humanizeField).join(', ')}`;
    }
    case 'note_added':
      return 'Follow-up note';
    case 'attachment_added':
      return `Attached ${event.detail.file_name ?? 'a file'}`;
    case 'attachment_removed':
      return `Removed ${event.detail.file_name ?? 'a file'}`;
    case 'notified': {
      const recipients = event.detail.recipients as string[] | undefined;
      return recipients && recipients.length > 0
        ? `Management notified (${recipients.map((r) => personName(r, people)).join(', ')})`
        : 'Management notification attempted';
    }
    default:
      return event.action;
  }
}

const humanizeField = (column: string): string => column.replace(/_/g, ' ');

/** Reviewer-owned fields, saved together. */
function ReviewFields({
  incident,
  onSave,
}: {
  incident: IncidentRow;
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [followUpRequired, setFollowUpRequired] = useState(incident.follow_up_required);
  const [followUpNotes, setFollowUpNotes] = useState(incident.follow_up_notes ?? '');
  const [correctiveActions, setCorrectiveActions] = useState(incident.corrective_actions ?? '');
  const [resolutionNotes, setResolutionNotes] = useState(incident.resolution_notes ?? '');

  const dirty =
    followUpRequired !== incident.follow_up_required ||
    followUpNotes !== (incident.follow_up_notes ?? '') ||
    correctiveActions !== (incident.corrective_actions ?? '') ||
    resolutionNotes !== (incident.resolution_notes ?? '');

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 font-mono text-xs text-white/70">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--pyre-red)]"
          checked={followUpRequired}
          onChange={(e) => setFollowUpRequired(e.target.checked)}
        />
        Follow-up still needed
      </label>

      <div>
        {/** biome-ignore lint/a11y/noLabelWithoutControl: label heads the textarea below */}
        <label className={labelClass}>Follow-up notes</label>
        <textarea
          className={`${inputClass} min-h-[70px]`}
          maxLength={FIELD_LIMITS.followUpNotes}
          value={followUpNotes}
          onChange={(e) => setFollowUpNotes(e.target.value)}
        />
      </div>

      <div>
        {/** biome-ignore lint/a11y/noLabelWithoutControl: label heads the textarea below */}
        <label className={labelClass}>Corrective actions — what changed so it doesn't recur</label>
        <textarea
          className={`${inputClass} min-h-[70px]`}
          maxLength={FIELD_LIMITS.correctiveActions}
          value={correctiveActions}
          onChange={(e) => setCorrectiveActions(e.target.value)}
        />
      </div>

      <div>
        {/** biome-ignore lint/a11y/noLabelWithoutControl: label heads the textarea below */}
        <label className={labelClass}>Resolution</label>
        <textarea
          className={`${inputClass} min-h-[70px]`}
          maxLength={FIELD_LIMITS.resolutionNotes}
          value={resolutionNotes}
          onChange={(e) => setResolutionNotes(e.target.value)}
        />
      </div>

      <button
        type="button"
        className={primaryButtonClass}
        disabled={!dirty}
        onClick={() =>
          void onSave({
            followUpRequired,
            followUpNotes,
            correctiveActions,
            resolutionNotes,
          })
        }
      >
        Save follow-up
      </button>
    </div>
  );
}

/**
 * Correcting the record. Only the fields that actually get corrected in
 * practice — a mistyped time, the wrong sauna, a severity that reads
 * differently the next morning — plus the account itself.
 */
function EditPanel({
  incident,
  canManage,
  onCancel,
  onSave,
}: {
  incident: IncidentRow;
  canManage: boolean;
  onCancel: () => void;
  onSave: (changes: Record<string, unknown>) => Promise<void>;
}) {
  const toLocal = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const [category, setCategory] = useState(incident.category);
  const [severity, setSeverity] = useState<string>(incident.severity);
  const [occurredAtLocal, setOccurredAtLocal] = useState(toLocal(incident.occurred_at));
  const [area, setArea] = useState(incident.area);
  const [areaDetail, setAreaDetail] = useState(incident.area_detail ?? '');
  const [description, setDescription] = useState(incident.description);
  const [immediateActions, setImmediateActions] = useState(incident.immediate_actions);

  return (
    <section className={`${cardClass} space-y-4`}>
      <SectionTitle
        note={
          canManage
            ? 'Corrections are recorded with the previous value, so the original account stays visible in the trail below.'
            : 'You can correct your own report for an hour after filing. After that, add a follow-up note instead.'
        }
      >
        Correct the report
      </SectionTitle>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          {/** biome-ignore lint/a11y/noLabelWithoutControl: label heads the select below */}
          <label className={labelClass}>Type</label>
          <select
            className={inputClass}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          {/** biome-ignore lint/a11y/noLabelWithoutControl: label heads the select below */}
          <label className={labelClass}>Severity</label>
          <select
            className={inputClass}
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          >
            {SEVERITY_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          {/** biome-ignore lint/a11y/noLabelWithoutControl: label heads the input below */}
          <label className={labelClass}>Occurred</label>
          <input
            type="datetime-local"
            className={inputClass}
            value={occurredAtLocal}
            onChange={(e) => setOccurredAtLocal(e.target.value)}
          />
        </div>
        <div>
          {/** biome-ignore lint/a11y/noLabelWithoutControl: label heads the select below */}
          <label className={labelClass}>Area</label>
          <select className={inputClass} value={area} onChange={(e) => setArea(e.target.value)}>
            {INCIDENT_AREAS.map((a) => (
              <option key={a} value={a}>
                {AREA_LABELS[a]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        {/** biome-ignore lint/a11y/noLabelWithoutControl: label heads the input below */}
        <label className={labelClass}>Exactly where</label>
        <input
          className={inputClass}
          maxLength={FIELD_LIMITS.areaDetail}
          value={areaDetail}
          onChange={(e) => setAreaDetail(e.target.value)}
        />
      </div>

      <div>
        {/** biome-ignore lint/a11y/noLabelWithoutControl: label heads the textarea below */}
        <label className={labelClass}>What happened</label>
        <textarea
          className={`${inputClass} min-h-[140px]`}
          maxLength={FIELD_LIMITS.description}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div>
        {/** biome-ignore lint/a11y/noLabelWithoutControl: label heads the textarea below */}
        <label className={labelClass}>What staff did</label>
        <textarea
          className={`${inputClass} min-h-[100px]`}
          maxLength={FIELD_LIMITS.immediateActions}
          value={immediateActions}
          onChange={(e) => setImmediateActions(e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className={primaryButtonClass}
          onClick={() =>
            void onSave({
              category,
              severity,
              occurredAt: new Date(occurredAtLocal).toISOString(),
              area,
              areaDetail,
              description,
              immediateActions,
            })
          }
        >
          Save corrections
        </button>
        <button type="button" className={formButtonClass} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function AttachmentPanel({
  incidentId,
  attachments,
  canAdd,
  canManage,
  self,
  people,
  onChanged,
  onRemoved,
}: {
  incidentId: string;
  attachments: IncidentAttachmentRow[];
  canAdd: boolean;
  canManage: boolean;
  self: string;
  people: PeopleNames;
  onChanged: () => Promise<void>;
  /** Take an attachment off the page before the server confirms. */
  onRemoved: (id: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setError(null);
    setUploading(true);

    try {
      for (const original of Array.from(list)) {
        const problem = checkFile(original);
        if (problem) {
          setError(problem);
          continue;
        }
        const file = await downscaleImage(original);
        const body = new FormData();
        body.set('incidentId', incidentId);
        body.set('file', file);

        const res = await fetch('/api/admin/incident-media', { method: 'POST', body });
        if (!res.ok) {
          setError(await readError(res));
          break;
        }
      }
      // The log shows an attachment count per report.
      invalidateJson('/api/admin/incidents');
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const remove = async (attachment: IncidentAttachmentRow) => {
    if (
      !(await confirmAction({
        title: `Remove ${attachment.file_name}?`,
        body: 'This is recorded in the trail.',
        confirmLabel: 'Remove',
        danger: true,
      }))
    )
      return;
    setError(null);
    // Gone from the grid at once; a refusal brings it back with the reload.
    onRemoved(attachment.id);
    const res = await fetch(`/api/admin/incident-media?id=${encodeURIComponent(attachment.id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) setError(await readError(res));
    // The trail records the removal (and the log counts attachments).
    invalidateJson('/api/admin/incidents');
    await onChanged();
  };

  return (
    <section className={cardClass}>
      <SectionTitle note="Media is private — these links are signed and expire in minutes.">
        Photos and video
      </SectionTitle>

      {attachments.length === 0 && <p className="text-sm text-white/45">Nothing attached.</p>}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {attachments.map((attachment) => {
          const src = `/api/admin/incident-media?id=${encodeURIComponent(attachment.id)}`;
          const removable = canManage || attachment.uploaded_by === self;
          return (
            <li key={attachment.id} className="rounded border border-white/10 bg-white/5 p-2">
              {attachment.kind === 'photo' ? (
                <a href={src} target="_blank" rel="noreferrer">
                  <img
                    src={src}
                    alt={attachment.caption || attachment.file_name}
                    className="h-32 w-full rounded object-cover"
                  />
                </a>
              ) : attachment.kind === 'video' ? (
                // biome-ignore lint/a11y/useMediaCaption: incident footage has no caption track
                <video src={src} controls className="h-32 w-full rounded bg-black object-contain" />
              ) : (
                <a
                  href={src}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-32 w-full items-center justify-center rounded bg-white/5 text-3xl"
                >
                  📄
                </a>
              )}

              <p className="mt-1.5 truncate text-xs text-white/70" title={attachment.file_name}>
                {attachment.caption || attachment.file_name}
              </p>
              <p className="font-mono text-[10px] text-white/30">
                {formatBytes(attachment.size_bytes)} · {personName(attachment.uploaded_by, people)}
              </p>
              <div className="mt-1 flex gap-2">
                <a
                  href={`${src}&download=1`}
                  className="font-mono text-[10px] uppercase text-white/40 hover:text-white"
                >
                  download
                </a>
                {removable && (
                  <button
                    type="button"
                    className="font-mono text-[10px] uppercase text-white/40 hover:text-[var(--pyre-red)]"
                    onClick={() => void remove(attachment)}
                  >
                    remove
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {canAdd && attachments.length < MAX_ATTACHMENTS_PER_INCIDENT && (
        <div className="mt-4 flex flex-wrap gap-2">
          <label className={`${formButtonClass} cursor-pointer`}>
            📷 Take a photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                void upload(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          <label className={`${formButtonClass} cursor-pointer`}>
            🎬 Add files
            <input
              type="file"
              accept={ACCEPT_ATTRIBUTE}
              multiple
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                void upload(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          {uploading && <span className="font-mono text-xs text-white/40">Uploading…</span>}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-[var(--pyre-red)]">{error}</p>}
    </section>
  );
}
