// Partner discount management: the registry (who our partners are, who
// verifies their members, and every lever we have) plus the verification
// request queue. Two tabs over two API routes; the manage capability gates
// every mutation, so a read-only grant still gets the full picture.

import { useEffect, useMemo, useState } from 'react';
import { confirmAction } from '@/components/admin/ConfirmDialog';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { buttonClass, inputClass } from '@/components/admin/ui';
import { sendJson } from '@/lib/client/api';
import { useCachedJson } from '@/lib/client/cachedJson';
import { fmtShortDate } from '@/lib/client/format';
import { optimistic, tempId } from '@/lib/client/optimistic';
import type { PartnerRow, PartnerVerificationRow } from '@/lib/db';

const pillClass = (active: boolean) =>
  `px-2.5 py-1.5 rounded text-xs font-mono uppercase tracking-wide border transition-colors ${
    active
      ? 'border-[var(--pyre-red)] bg-[var(--pyre-red)]/15 text-[var(--pyre-creme)]'
      : 'border-white/10 bg-white/5 text-white/50 hover:border-white/30 hover:text-white'
  }`;

const sectionHeading = 'font-mono text-xs font-bold uppercase tracking-wide text-white/40';
const card = 'rounded-lg border border-white/10 bg-white/[0.03] p-3';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The landing page hardcodes its own copy of each partner's discount, so a
// change here alone silently disagrees with what /bft advertises. Keyed by
// slug and compared on load, this only nags when they actually diverge.
const LANDING_PAGE_DISCOUNTS: Record<string, number> = { bft: 15 };

interface PartnersPayload {
  partners: PartnerRow[];
  legacyEnvContacts: { slug: string; email: string }[];
  ccEmailEnv: string | null;
  partnerTemplatesLive: boolean;
  tagStatus: Record<string, boolean | null>;
  counts: Record<string, { pending: number; confirmed: number; total: number }>;
  canManage: boolean;
}

interface RequestsPayload {
  requests: PartnerVerificationRow[];
  counts: Record<string, number>;
  canManage: boolean;
}

// --- Registry ---

interface PartnerFormState {
  name: string;
  slug: string;
  tagName: string;
  discountPercent: string;
  contactEmails: string[];
  ccEmail: string;
  decisionExpiryDays: string;
  enabled: boolean;
  reconciliationEnabled: boolean;
  notes: string;
}

const blankForm = (): PartnerFormState => ({
  name: '',
  slug: '',
  tagName: '',
  discountPercent: '15',
  contactEmails: [],
  ccEmail: '',
  decisionExpiryDays: '14',
  enabled: true,
  reconciliationEnabled: true,
  notes: '',
});

const formFromRow = (p: PartnerRow): PartnerFormState => ({
  name: p.name,
  slug: p.slug,
  tagName: p.tag_name,
  discountPercent: String(p.discount_percent),
  contactEmails: [...p.contact_emails],
  ccEmail: p.cc_email ?? '',
  decisionExpiryDays: String(p.decision_expiry_days),
  enabled: p.enabled,
  reconciliationEnabled: p.reconciliation_enabled,
  notes: p.notes ?? '',
});

function ContactList({
  emails,
  disabled,
  onChange,
}: {
  emails: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const email = draft.trim().toLowerCase();
    if (!email) return;
    if (!EMAIL_RE.test(email)) {
      setError('That doesn’t look like an email address');
      return;
    }
    if (emails.includes(email)) {
      setError('Already on the list');
      return;
    }
    onChange([...emails, email]);
    setDraft('');
    setError(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {emails.map((email) => (
          <span
            key={email}
            className="flex items-center gap-2 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-[var(--pyre-creme)]"
          >
            {email}
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${email}`}
                className="text-white/40 hover:text-[var(--pyre-red)]"
                onClick={() => onChange(emails.filter((e) => e !== email))}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {emails.length === 0 && (
          <span className="font-mono text-xs text-white/30">No contacts — nobody can verify</span>
        )}
      </div>
      {!disabled && (
        <div className="flex flex-wrap gap-2">
          <input
            type="email"
            aria-label="Add contact email"
            className={`${inputClass} min-w-[16rem] flex-1`}
            placeholder="who@partner.com"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <button type="button" className={buttonClass} onClick={add}>
            Add
          </button>
        </div>
      )}
      {error && <p className="font-mono text-xs text-[var(--pyre-red)]">{error}</p>}
    </div>
  );
}

function PartnerCard({
  partner,
  data,
  canManage,
  busy,
  onSave,
  onDelete,
}: {
  partner: PartnerRow | null;
  data: PartnersPayload;
  canManage: boolean;
  busy: boolean;
  onSave: (form: PartnerFormState, id: string | null) => Promise<void>;
  onDelete: (partner: PartnerRow) => Promise<void>;
}) {
  const [open, setOpen] = useState(partner === null);
  const [form, setForm] = useState<PartnerFormState>(partner ? formFromRow(partner) : blankForm());

  // Re-sync when the row is refetched after a save.
  useEffect(() => {
    if (partner) setForm(formFromRow(partner));
  }, [partner]);

  const set = <K extends keyof PartnerFormState>(key: K, value: PartnerFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const counts = partner ? data.counts[partner.slug] : undefined;
  const tagOk = partner ? data.tagStatus[partner.slug] : undefined;
  const landingDiscount = partner ? LANDING_PAGE_DISCOUNTS[partner.slug] : undefined;
  const discountDiverged =
    landingDiscount !== undefined &&
    partner !== null &&
    landingDiscount !== partner.discount_percent;

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-bold text-[var(--pyre-creme)]">
          {partner ? partner.name : 'New partner'}
        </span>
        {partner && (
          <>
            <span className="font-mono text-xs text-white/40">/{partner.slug}</span>
            <span className={pillClass(partner.enabled)}>
              {partner.enabled ? 'Enabled' : 'Disabled'}
            </span>
            <span className="font-mono text-xs text-white/50">{partner.discount_percent}% off</span>
            {tagOk === false && (
              <span className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-2 py-0.5 font-mono text-xs text-[var(--pyre-red)]">
                Tag “{partner.tag_name}” not in Momence
              </span>
            )}
            {tagOk === null && (
              <span className="font-mono text-xs text-white/30">Tag unverified</span>
            )}
            {counts && counts.pending > 0 && (
              <span className="font-mono text-xs text-[var(--pyre-gold)]">
                {counts.pending} pending
              </span>
            )}
            <button
              type="button"
              className={`${buttonClass} ml-auto`}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? 'Close' : 'Edit'}
            </button>
          </>
        )}
      </div>

      {discountDiverged && (
        <p className="mt-2 rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-gold)]">
          The /{partner?.slug} landing page still advertises {landingDiscount}%. The discount here
          only affects our emails — update <code>apps/landing-page/src/lib/{partner?.slug}.ts</code>{' '}
          (percent, price multiplier, and copy) and the Momence price rule to match.
        </p>
      )}

      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1">
              <span className={sectionHeading}>Name</span>
              <input
                className={inputClass}
                value={form.name}
                disabled={!canManage}
                onChange={(e) => set('name', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={sectionHeading}>Slug</span>
              <input
                className={inputClass}
                value={form.slug}
                // Permanent once created: verification rows, live confirm/deny
                // links, and the landing page form all key on it.
                disabled={partner !== null || !canManage}
                placeholder="bft"
                onChange={(e) => set('slug', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={sectionHeading}>Momence tag</span>
              <input
                className={inputClass}
                value={form.tagName}
                disabled={!canManage}
                onChange={(e) => set('tagName', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={sectionHeading}>Discount %</span>
              <input
                className={`${inputClass} w-24`}
                type="number"
                min={1}
                max={99}
                value={form.discountPercent}
                disabled={!canManage}
                onChange={(e) => set('discountPercent', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={sectionHeading}>Link expiry (days)</span>
              <input
                className={`${inputClass} w-24`}
                type="number"
                min={1}
                max={90}
                value={form.decisionExpiryDays}
                disabled={!canManage}
                onChange={(e) => set('decisionExpiryDays', e.target.value)}
              />
            </label>
          </div>

          <div className="space-y-1">
            <span className={sectionHeading}>Who verifies membership</span>
            <p className="font-mono text-xs text-white/30">
              Everyone here gets their own copy of the confirm/deny email. Whoever clicks first
              decides.
            </p>
            <ContactList
              emails={form.contactEmails}
              disabled={!canManage}
              onChange={(next) => set('contactEmails', next)}
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className={sectionHeading}>CC (optional)</span>
              <input
                className={inputClass}
                value={form.ccEmail}
                disabled={!canManage}
                placeholder={data.ccEmailEnv ?? 'none'}
                onChange={(e) => set('ccEmail', e.target.value)}
              />
            </label>
            <button
              type="button"
              className={pillClass(form.enabled)}
              disabled={!canManage}
              onClick={() => set('enabled', !form.enabled)}
            >
              {form.enabled ? 'Accepting requests' : 'Not accepting'}
            </button>
            <button
              type="button"
              className={pillClass(form.reconciliationEnabled)}
              disabled={!canManage}
              onClick={() => set('reconciliationEnabled', !form.reconciliationEnabled)}
            >
              {form.reconciliationEnabled ? 'Quarterly recap on' : 'Quarterly recap off'}
            </button>
          </div>

          <label className="flex flex-col gap-1">
            <span className={sectionHeading}>Notes</span>
            <textarea
              className={inputClass}
              rows={2}
              value={form.notes}
              disabled={!canManage}
              onChange={(e) => set('notes', e.target.value)}
            />
          </label>

          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={buttonClass}
                disabled={busy}
                onClick={() => onSave(form, partner?.id ?? null)}
              >
                {partner ? 'Save' : 'Add partner'}
              </button>
              {partner && (counts?.total ?? 0) === 0 && (
                <button
                  type="button"
                  className={`${buttonClass} ml-auto hover:border-[var(--pyre-red)]/60 hover:text-[var(--pyre-red)]`}
                  disabled={busy}
                  onClick={() => onDelete(partner)}
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Request queue ---

const STATUS_FILTERS = ['pending', 'confirmed', 'denied', 'expired', 'revoked'] as const;

function RequestRow({
  request,
  canManage,
  busy,
  onAction,
}: {
  request: PartnerVerificationRow;
  canManage: boolean;
  busy: boolean;
  onAction: (id: string, action: string) => Promise<void>;
}) {
  const name = `${request.customer_first_name} ${request.customer_last_name}`.trim();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded border border-white/10 bg-white/[0.03] px-3 py-2">
      <span className="text-[var(--pyre-creme)]">{name}</span>
      <span className="font-mono text-xs text-white/50">{request.customer_email}</span>
      <span className="font-mono text-xs text-white/30">/{request.partner_slug}</span>
      <span className={pillClass(request.status === 'confirmed')}>{request.status}</span>
      {request.notified_count === 0 && request.status === 'pending' && (
        <span className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-2 py-0.5 font-mono text-xs text-[var(--pyre-red)]">
          No contact emailed
        </span>
      )}
      <span className="font-mono text-xs text-white/30">
        {fmtShortDate(request.created_at)}
        {request.decided_at && ` → ${fmtShortDate(request.decided_at)}`}
        {request.decided_by && ` by ${request.decided_by}`}
      </span>
      {canManage && request.status === 'pending' && (
        <span className="ml-auto flex gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => onAction(request.id, 'resend')}
          >
            Resend
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => onAction(request.id, 'confirm')}
          >
            Confirm
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => onAction(request.id, 'deny')}
          >
            Deny
          </button>
        </span>
      )}
    </div>
  );
}

// --- Shell ---

/** The page's first read; lib/client/pageData warms it when a link here is hovered. */
const PARTNERS_URL = '/api/admin/partners';

/** The partner row as it will read once the API applies `form` to it. */
function applyForm(partner: PartnerRow, form: PartnerFormState): PartnerRow {
  return {
    ...partner,
    name: form.name,
    tag_name: form.tagName,
    discount_percent: Number(form.discountPercent),
    contact_emails: [...form.contactEmails],
    cc_email: form.ccEmail || null,
    decision_expiry_days: Number(form.decisionExpiryDays),
    enabled: form.enabled,
    reconciliation_enabled: form.reconciliationEnabled,
    notes: form.notes || null,
    updated_at: new Date().toISOString(),
  };
}

/** What a request's status becomes under an admin action, or null if that is the server's call. */
function statusAfter(action: string): PartnerVerificationRow['status'] | null {
  switch (action) {
    case 'confirm':
      return 'confirmed';
    case 'deny':
      return 'denied';
    case 'revoke':
      return 'revoked';
    default:
      return null;
  }
}

export function PartnersManager() {
  const [tab, setTab] = useState<'partners' | 'requests'>('partners');
  const [statusFilter, setStatusFilter] = useState<string | null>('pending');
  const [partnerFilter, setPartnerFilter] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Only the new-partner form guards against a double submit; the cards and
  // the queue stay usable while a save is out.
  const [saving, setSaving] = useState(false);
  const [actionError, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Both reads are cached across navigations and keyed by their full URL,
  // so each filter combination of the queue repaints from cache. Every
  // action below changes the list on screen first; the server's answer
  // (counts, tag status, the real id of a new partner) follows behind it.
  const partners = useCachedJson<PartnersPayload>(PARTNERS_URL);
  const data = partners.data;
  const queueUrl = useMemo(() => {
    if (tab !== 'requests') return null;
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (partnerFilter) params.set('partner', partnerFilter);
    return `/api/admin/partner-requests?${params}`;
  }, [tab, statusFilter, partnerFilter]);
  const requests = useCachedJson<RequestsPayload>(queueUrl);
  const queue = requests.data;
  const error = actionError ?? partners.error ?? requests.error;

  const savePartner = async (form: PartnerFormState, id: string | null) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    const payload = {
      ...(id ? { id } : { slug: form.slug.trim().toLowerCase() }),
      name: form.name,
      tagName: form.tagName,
      discountPercent: Number(form.discountPercent),
      contactEmails: form.contactEmails,
      ccEmail: form.ccEmail,
      decisionExpiryDays: Number(form.decisionExpiryDays),
      enabled: form.enabled,
      reconciliationEnabled: form.reconciliationEnabled,
      notes: form.notes,
    };
    const pendingId = id ?? tempId();
    const body = await optimistic(
      partners.setData,
      (prev) => {
        if (!prev) return prev;
        if (id) {
          return {
            ...prev,
            partners: prev.partners.map((p) => (p.id === id ? applyForm(p, form) : p)),
          };
        }
        const now = new Date().toISOString();
        const fresh = applyForm(
          {
            id: pendingId,
            slug: form.slug.trim().toLowerCase(),
            name: form.name,
            tag_name: form.tagName,
            discount_percent: 0,
            contact_emails: [],
            cc_email: null,
            enabled: false,
            decision_expiry_days: 0,
            reconciliation_enabled: false,
            notes: null,
            created_by: null,
            updated_by: null,
            created_at: now,
            updated_at: now,
          },
          form
        );
        return { ...prev, partners: [...prev.partners, fresh] };
      },
      () => sendJson<{ retagWarningCount?: number }>(PARTNERS_URL, id ? 'PATCH' : 'POST', payload),
      { onError: setError }
    );
    setSaving(false);
    if (!body) return;
    if (body.retagWarningCount) {
      setNotice(
        `Tag changed. ${body.retagWarningCount} already-confirmed member${body.retagWarningCount === 1 ? '' : 's'} still carry the old tag — rename it in Momence too, or they lose the discount.`
      );
    }
    setAdding(false);
    // The tag status and counts, and a new partner's real id, come from the server.
    void partners.reload();
  };

  const deletePartner = async (partner: PartnerRow) => {
    if (
      !(await confirmAction({
        title: `Delete ${partner.name}?`,
        body: "This can't be undone.",
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    setError(null);
    await optimistic(
      partners.setData,
      (prev) => prev && { ...prev, partners: prev.partners.filter((p) => p.id !== partner.id) },
      () => sendJson(`${PARTNERS_URL}?id=${encodeURIComponent(partner.id)}`, 'DELETE'),
      { onError: setError }
    );
  };

  const importLegacy = async (slug: string, email: string) => {
    const partner = data?.partners.find((p) => p.slug === slug);
    if (!partner) return;
    await savePartner({ ...formFromRow(partner), contactEmails: [email] }, partner.id);
  };

  const requestAction = async (id: string, action: string) => {
    if (
      action === 'deny' &&
      !(await confirmAction({
        title: 'Deny this request?',
        body: 'The customer is emailed.',
        confirmLabel: 'Deny',
        danger: true,
      }))
    )
      return;
    setError(null);
    setNotice(null);
    const next = statusAfter(action);
    const body = await optimistic(
      requests.setData,
      (prev) => {
        if (!prev || !next) return prev;
        const row = prev.requests.find((r) => r.id === id);
        if (!row || row.status === next) return prev;
        const counts = { ...prev.counts };
        counts[row.status] = Math.max(0, (counts[row.status] ?? 0) - 1);
        counts[next] = (counts[next] ?? 0) + 1;
        const decided = { ...row, status: next, decided_at: new Date().toISOString() };
        return {
          ...prev,
          counts,
          // A row that no longer matches the status filter leaves the list.
          requests:
            statusFilter && statusFilter !== next
              ? prev.requests.filter((r) => r.id !== id)
              : prev.requests.map((r) => (r.id === id ? decided : r)),
        };
      },
      () =>
        sendJson<{ results?: { email: string; status: string }[] }>(
          '/api/admin/partner-requests',
          'POST',
          { id, action }
        ),
      { onError: setError }
    );
    if (!body) return;
    if (body.results) {
      setNotice(body.results.map((r) => `${r.email}: ${r.status}`).join(' · '));
    }
    // Who the action reached, and the per-partner counts, come from the server.
    void requests.reload();
    void partners.reload();
  };

  if (partners.loading) {
    return <p className="font-mono text-sm text-white/40">Loading…</p>;
  }

  const canManage = data?.canManage ?? false;

  return (
    <div className="space-y-6">
      {error && <ErrorBanner mono>{error}</ErrorBanner>}
      {notice && (
        <p className="rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-gold)]">
          {notice}
        </p>
      )}
      {data && !data.partnerTemplatesLive && (
        <p className="rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-gold)]">
          Partner emails are not live: <code>partner-*</code> is missing from
          <code> EMAIL_LIVE_TEMPLATES</code>, so they only reach addresses on
          <code> EMAIL_DEV_WHITELIST</code>. New requests will be rejected rather than sitting
          unanswered.
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          className={pillClass(tab === 'partners')}
          onClick={() => setTab('partners')}
        >
          Partners
        </button>
        <button
          type="button"
          className={pillClass(tab === 'requests')}
          onClick={() => setTab('requests')}
        >
          Requests
        </button>
      </div>

      {tab === 'partners' && data && (
        <div className="space-y-3">
          {data.legacyEnvContacts.length > 0 && (
            <div className={card}>
              <p className={sectionHeading}>From env vars</p>
              <p className="mt-1 font-mono text-xs text-white/30">
                Still falling back to the old contact env var. Import it here, then the env var can
                be deleted from the deployment.
              </p>
              {data.legacyEnvContacts.map((entry) => (
                <div key={entry.slug} className="mt-2 flex flex-wrap items-center gap-3">
                  <span className="font-mono text-xs text-white/50">/{entry.slug}</span>
                  <span className="text-sm text-[var(--pyre-creme)]">{entry.email}</span>
                  {canManage && (
                    <button
                      type="button"
                      className={`${buttonClass} ml-auto`}
                      disabled={saving}
                      onClick={() => importLegacy(entry.slug, entry.email)}
                    >
                      Import
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {data.partners.map((partner) => (
            <PartnerCard
              key={partner.id}
              partner={partner}
              data={data}
              canManage={canManage}
              busy={false}
              onSave={savePartner}
              onDelete={deletePartner}
            />
          ))}

          {adding ? (
            <PartnerCard
              partner={null}
              data={data}
              canManage={canManage}
              busy={saving}
              onSave={savePartner}
              onDelete={deletePartner}
            />
          ) : (
            canManage && (
              <button type="button" className={buttonClass} onClick={() => setAdding(true)}>
                Add partner
              </button>
            )
          )}

          <p className="font-mono text-xs text-white/30">
            Create the Momence customer tag and its tag-keyed price rule before enabling a partner —
            confirms fail until both exist.
          </p>
        </div>
      )}

      {tab === 'requests' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={pillClass(statusFilter === null)}
              onClick={() => setStatusFilter(null)}
            >
              All {queue ? Object.values(queue.counts).reduce((a, b) => a + b, 0) : ''}
            </button>
            {STATUS_FILTERS.map((status) => (
              <button
                key={status}
                type="button"
                className={pillClass(statusFilter === status)}
                onClick={() => setStatusFilter(status)}
              >
                {status} {queue?.counts[status] ?? 0}
              </button>
            ))}
          </div>

          {data && data.partners.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={pillClass(partnerFilter === null)}
                onClick={() => setPartnerFilter(null)}
              >
                All partners
              </button>
              {data.partners.map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  className={pillClass(partnerFilter === p.slug)}
                  onClick={() => setPartnerFilter(p.slug)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}

          {queue?.requests.length === 0 && (
            <p className="font-mono text-xs text-white/30">No requests match.</p>
          )}
          {queue?.requests.map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              canManage={canManage}
              busy={false}
              onAction={requestAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default PartnersManager;
