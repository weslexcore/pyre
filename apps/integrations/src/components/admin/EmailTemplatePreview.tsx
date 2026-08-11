import { useCallback, useEffect, useRef, useState } from 'react';

// Email template browser island (/admin/email-templates). Lists every
// registered template, lets the admin edit the props JSON, and renders through
// the admin-gated /api/admin/email-preview route — so the preview is the exact
// HTML sendTemplate() would send. Template data (keys, default props, session
// types) is passed in from the Astro page; this island never imports the
// server-side email code.

export interface TemplateOption {
  key: string;
  defaultProps: Record<string, unknown>;
  /** Effective live status — delivers to real recipients. */
  live: boolean;
  /** 'db' = dashboard override row; 'env' = EMAIL_LIVE_TEMPLATES pattern. */
  source: 'db' | 'env';
}

export interface WhitelistEntry {
  email: string;
  /** 'env' entries are read-only; 'db' rows are managed here. */
  source: 'env' | 'db';
}

interface GateTemplateState {
  live: boolean;
  source: 'db' | 'env';
}

/** Mirror of the /api/admin/email-gate snapshot every mutation returns. */
interface GateSnapshot {
  templates: { key: string; live: boolean; source: 'db' | 'env' }[];
  whitelist: WhitelistEntry[];
  dbAvailable: boolean;
}

interface EmailTemplatePreviewProps {
  templates: TemplateOption[];
  /** Session types with dedicated confirmation copy — preset chips. */
  confirmationSessionTypes: string[];
  /** Raw EMAIL_LIVE_TEMPLATES value, for the config summary. */
  liveTemplatesConfig: string;
  /** Effective whitelist (env + dashboard) — receives ALL templates. */
  whitelist: WhitelistEntry[];
  /** False when Supabase is unreachable — gate editing disabled. */
  dbAvailable: boolean;
}

interface PreviewState {
  html: string;
  subject: string;
}

type SendState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'sent'; id: string | null; to: string }
  | { phase: 'error'; message: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Last-used test address survives reloads.
const TEST_EMAIL_STORAGE_KEY = 'pyre-admin-test-email';

export function EmailTemplatePreview({
  templates,
  confirmationSessionTypes,
  liveTemplatesConfig,
  whitelist,
  dbAvailable,
}: EmailTemplatePreviewProps) {
  const [selectedKey, setSelectedKey] = useState(templates[0]?.key ?? '');
  const [propsJson, setPropsJson] = useState(() =>
    JSON.stringify(templates[0]?.defaultProps ?? {}, null, 2)
  );
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [sendState, setSendState] = useState<SendState>({ phase: 'idle' });
  // Delivery-gate state, seeded server-side and replaced wholesale by the
  // snapshot every /api/admin/email-gate mutation returns.
  const [gateTemplates, setGateTemplates] = useState<Record<string, GateTemplateState>>(() =>
    Object.fromEntries(templates.map((t) => [t.key, { live: t.live, source: t.source }]))
  );
  const [gateWhitelist, setGateWhitelist] = useState<WhitelistEntry[]>(whitelist);
  const [gateDbAvailable, setGateDbAvailable] = useState(dbAvailable);
  const [gateBusy, setGateBusy] = useState<string | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [newWhitelistEmail, setNewWhitelistEmail] = useState('');
  // Drops stale responses when a newer render has been requested.
  const requestSeq = useRef(0);

  const renderTemplate = useCallback(async (template: string, json: string) => {
    let props: unknown;
    try {
      props = JSON.parse(json);
    } catch (parseError) {
      setError(
        `Invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`
      );
      return;
    }

    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/email-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template, props }),
      });
      const body = await res.json();
      if (seq !== requestSeq.current) return;
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setPreview({ html: body.html, subject: body.subject });
    } catch (fetchError) {
      if (seq !== requestSeq.current) return;
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  // Initial render of the first template with its defaults.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only initial render
  useEffect(() => {
    if (selectedKey) void renderTemplate(selectedKey, propsJson);
    try {
      const stored = window.localStorage.getItem(TEST_EMAIL_STORAGE_KEY);
      if (stored) setTestEmail(stored);
    } catch {
      // localStorage unavailable — the field just starts empty.
    }
  }, []);

  const selectTemplate = (option: TemplateOption) => {
    const json = JSON.stringify(option.defaultProps, null, 2);
    setSelectedKey(option.key);
    setPropsJson(json);
    setSendState({ phase: 'idle' });
    void renderTemplate(option.key, json);
  };

  const sendTest = async () => {
    let props: unknown;
    try {
      props = JSON.parse(propsJson);
    } catch {
      return; // Button is disabled on invalid JSON; guard anyway.
    }
    const to = testEmail.trim();
    setSendState({ phase: 'sending' });
    try {
      const res = await fetch('/api/admin/email-test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: selectedKey, props, to }),
      });
      const body = await res.json();
      if (!res.ok) {
        setSendState({ phase: 'error', message: body.error ?? `Request failed (${res.status})` });
        return;
      }
      setSendState({ phase: 'sent', id: body.id ?? null, to: body.to ?? to });
      try {
        window.localStorage.setItem(TEST_EMAIL_STORAGE_KEY, to);
      } catch {
        // Best-effort persistence only.
      }
    } catch (fetchError) {
      setSendState({
        phase: 'error',
        message: fetchError instanceof Error ? fetchError.message : String(fetchError),
      });
    }
  };

  const resetToDefaults = () => {
    const option = templates.find((t) => t.key === selectedKey);
    if (!option) return;
    const json = JSON.stringify(option.defaultProps, null, 2);
    setPropsJson(json);
    void renderTemplate(selectedKey, json);
  };

  // Patches sessionType into the current props (keeping any other edits) and
  // re-renders — one-click browsing of the confirmation variants.
  const applySessionType = (sessionType: string) => {
    let props: Record<string, unknown>;
    try {
      props = JSON.parse(propsJson);
    } catch {
      const option = templates.find((t) => t.key === selectedKey);
      props = { ...(option?.defaultProps ?? {}) };
    }
    props.sessionType = sessionType;
    const json = JSON.stringify(props, null, 2);
    setPropsJson(json);
    void renderTemplate(selectedKey, json);
  };

  // One mutation in flight at a time; the returned snapshot replaces all gate
  // state so the UI can never drift from the server.
  const postGateAction = async (payload: Record<string, unknown>, busyKey: string) => {
    setGateBusy(busyKey);
    setGateError(null);
    try {
      const res = await fetch('/api/admin/email-gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setGateError(body.error ?? `Request failed (${res.status})`);
        return false;
      }
      const snapshot = body as GateSnapshot;
      setGateTemplates(
        Object.fromEntries(
          snapshot.templates.map((t) => [t.key, { live: t.live, source: t.source }])
        )
      );
      setGateWhitelist(snapshot.whitelist);
      setGateDbAvailable(snapshot.dbAvailable);
      return true;
    } catch (fetchError) {
      setGateError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      return false;
    } finally {
      setGateBusy(null);
    }
  };

  const toggleTemplateLive = (key: string) => {
    const current = gateTemplates[key];
    if (!current) return;
    void postGateAction({ action: 'set-template', template: key, live: !current.live }, key);
  };

  const clearTemplateOverride = (key: string) => {
    void postGateAction({ action: 'set-template', template: key, live: null }, key);
  };

  const addWhitelist = async () => {
    const email = newWhitelistEmail.trim();
    if (!EMAIL_RE.test(email)) return;
    const ok = await postGateAction({ action: 'add-whitelist', email }, 'whitelist');
    if (ok) setNewWhitelistEmail('');
  };

  const removeWhitelist = (email: string) => {
    void postGateAction({ action: 'remove-whitelist', email }, 'whitelist');
  };

  const currentSessionType = (() => {
    if (selectedKey !== 'confirmation') return null;
    try {
      const props = JSON.parse(propsJson);
      return typeof props.sessionType === 'string' ? props.sessionType : null;
    } catch {
      return null;
    }
  })();

  const liveCount = Object.values(gateTemplates).filter((t) => t.live).length;
  const selectedGate = gateTemplates[selectedKey];

  const propsValid = (() => {
    try {
      JSON.parse(propsJson);
      return true;
    } catch {
      return false;
    }
  })();
  const emailValid = EMAIL_RE.test(testEmail.trim());

  return (
    <div className="flex flex-col gap-6">
      {/* Delivery gate: which templates send for real, and who receives gated
          templates anyway. Editable — toggles and whitelist rows write
          dashboard overrides on top of the env baseline. */}
      <section className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/5 p-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-wide text-white/40">Delivery gate</p>
          <p className="mt-1 text-sm text-[var(--pyre-creme)]">
            {liveCount} of {templates.length} templates live
          </p>
          <p className="mt-1 font-mono text-xs text-white/50">
            env baseline: EMAIL_LIVE_TEMPLATES={liveTemplatesConfig}
          </p>
          {selectedGate?.source === 'db' && (
            <p className="mt-1.5 flex items-center gap-2 font-mono text-xs text-white/50">
              <span>
                {selectedKey}: {selectedGate.live ? 'live' : 'gated'} via dashboard override
              </span>
              <button
                type="button"
                onClick={() => clearTemplateOverride(selectedKey)}
                disabled={!gateDbAvailable || gateBusy !== null}
                className="rounded-full border border-white/20 px-2 py-0.5 text-[11px] uppercase tracking-wide text-white/50 transition-colors hover:border-white/40 hover:text-white/80 disabled:opacity-50"
              >
                Use env default
              </button>
            </p>
          )}
          {!gateDbAvailable && (
            <p className="mt-1.5 font-mono text-xs text-amber-400/80">
              Supabase unavailable — env config only, editing disabled.
            </p>
          )}
          {gateError && (
            <p className="mt-1.5 rounded-md border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 p-2 font-mono text-xs text-[var(--pyre-red)]">
              {gateError}
            </p>
          )}
        </div>
        <div className="lg:max-w-md lg:text-right">
          <p className="font-mono text-xs uppercase tracking-wide text-white/40">
            Whitelist recipients
          </p>
          <p className="mt-1 text-xs text-white/50">
            These addresses receive all templates, live or gated:
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5 lg:justify-end">
            {gateWhitelist.length > 0 ? (
              gateWhitelist.map((entry) => (
                <span
                  key={entry.email}
                  title={
                    entry.source === 'env' ? 'From EMAIL_DEV_WHITELIST (read-only)' : undefined
                  }
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] ${
                    entry.source === 'env'
                      ? 'border-white/10 text-white/40'
                      : 'border-white/20 text-white/70'
                  }`}
                >
                  {entry.email}
                  {entry.source === 'env' ? (
                    <span className="uppercase tracking-wide text-white/25">env</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => removeWhitelist(entry.email)}
                      disabled={!gateDbAvailable || gateBusy !== null}
                      aria-label={`Remove ${entry.email} from whitelist`}
                      className="text-white/40 transition-colors hover:text-[var(--pyre-red)] disabled:opacity-50"
                    >
                      ×
                    </button>
                  )}
                </span>
              ))
            ) : (
              <span className="font-mono text-[11px] uppercase tracking-wide text-white/30">
                (none — gated templates deliver to no one)
              </span>
            )}
          </div>
          <div className="mt-2 flex gap-1.5 lg:justify-end">
            <input
              type="email"
              value={newWhitelistEmail}
              onChange={(e) => setNewWhitelistEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addWhitelist();
              }}
              placeholder="add@example.com"
              spellCheck={false}
              disabled={!gateDbAvailable}
              className="w-44 rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-[11px] text-[var(--pyre-creme)] outline-none transition-colors focus:border-white/30 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void addWhitelist()}
              disabled={
                !gateDbAvailable || gateBusy !== null || !EMAIL_RE.test(newWhitelistEmail.trim())
              }
              className="rounded-md border border-white/20 px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wide text-[var(--pyre-creme)] transition-colors hover:border-white/40 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Template list */}
        <nav className="shrink-0 lg:w-56">
          <p className="mb-2 font-mono text-xs uppercase tracking-wide text-white/40">Templates</p>
          <ul className="flex flex-row flex-wrap gap-1 lg:flex-col">
            {templates.map((option) => {
              const state = gateTemplates[option.key] ?? {
                live: option.live,
                source: option.source,
              };
              return (
                <li key={option.key} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => selectTemplate(option)}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-2 text-left font-mono text-xs uppercase tracking-wide transition-colors ${
                      option.key === selectedKey
                        ? 'bg-white/10 text-[var(--pyre-creme)]'
                        : 'text-white/50 hover:bg-white/5 hover:text-white/80'
                    }`}
                  >
                    <span
                      title={
                        state.live ? 'Live — delivers to real recipients' : 'Gated — whitelist only'
                      }
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        state.live ? 'bg-emerald-400' : 'bg-white/20'
                      }`}
                    />
                    <span className="min-w-0 truncate">{option.key}</span>
                  </button>
                  {/* Flips a dashboard override on top of the env baseline;
                      "Use env default" in the gate panel clears it. */}
                  <button
                    type="button"
                    onClick={() => toggleTemplateLive(option.key)}
                    disabled={!gateDbAvailable || gateBusy !== null}
                    title={
                      state.source === 'db'
                        ? 'Dashboard override — click to flip'
                        : 'From env — click to override'
                    }
                    className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide transition-colors disabled:opacity-40 ${
                      state.live
                        ? 'border-emerald-400/40 text-emerald-400 hover:border-emerald-400'
                        : 'border-white/20 text-white/40 hover:border-white/40 hover:text-white/70'
                    }`}
                  >
                    {gateBusy === option.key ? '…' : state.live ? 'live' : 'gated'}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Props editor */}
        <section className="flex flex-col gap-3 lg:w-96 lg:shrink-0">
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs uppercase tracking-wide text-white/40">Props</p>
            <button
              type="button"
              onClick={resetToDefaults}
              className="font-mono text-xs uppercase tracking-wide text-white/50 underline transition-colors hover:text-white"
            >
              Reset to defaults
            </button>
          </div>

          {selectedKey === 'confirmation' && (
            <div className="flex flex-wrap gap-1.5">
              {confirmationSessionTypes.map((sessionType) => (
                <button
                  key={sessionType}
                  type="button"
                  onClick={() => applySessionType(sessionType)}
                  className={`rounded-full border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors ${
                    sessionType === currentSessionType
                      ? 'border-[var(--pyre-red)] bg-[var(--pyre-red)]/20 text-[var(--pyre-creme)]'
                      : 'border-white/20 text-white/50 hover:border-white/40 hover:text-white/80'
                  }`}
                >
                  {sessionType}
                </button>
              ))}
            </div>
          )}

          <textarea
            value={propsJson}
            onChange={(e) => setPropsJson(e.target.value)}
            spellCheck={false}
            rows={18}
            className="w-full resize-y rounded-md border border-white/10 bg-white/5 p-3 font-mono text-xs leading-relaxed text-[var(--pyre-creme)] outline-none transition-colors focus:border-white/30"
          />

          <button
            type="button"
            onClick={() => void renderTemplate(selectedKey, propsJson)}
            disabled={loading}
            className="rounded-md bg-[var(--pyre-red)] px-4 py-2 font-mono text-xs font-bold uppercase tracking-wide text-[var(--pyre-creme)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Rendering…' : 'Render'}
          </button>

          {error && (
            <p className="rounded-md border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 p-3 font-mono text-xs text-[var(--pyre-red)]">
              {error}
            </p>
          )}

          {/* Send the current props as a real email — bypasses the delivery
              gate via /api/admin/email-test-send, so it works for gated
              templates and any address. */}
          <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
            <p className="font-mono text-xs uppercase tracking-wide text-white/40">Send test</p>
            <p className="text-xs text-white/50">
              Bypasses the delivery gate — sends to any address, subject prefixed [TEST].
            </p>
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="you@example.com"
              spellCheck={false}
              className="w-full rounded-md border border-white/10 bg-white/5 p-2 font-mono text-xs text-[var(--pyre-creme)] outline-none transition-colors focus:border-white/30"
            />
            <button
              type="button"
              onClick={() => void sendTest()}
              disabled={!propsValid || !emailValid || sendState.phase === 'sending'}
              className="rounded-md border border-white/20 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wide text-[var(--pyre-creme)] transition-colors hover:border-white/40 disabled:opacity-50"
            >
              {sendState.phase === 'sending' ? 'Sending…' : 'Send test'}
            </button>
            {sendState.phase === 'sent' && (
              <p className="rounded-md border border-emerald-400/40 bg-emerald-400/10 p-3 font-mono text-xs text-emerald-400">
                Sent to {sendState.to}
                {sendState.id ? ` — Resend id ${sendState.id}` : ''}
              </p>
            )}
            {sendState.phase === 'error' && (
              <p className="rounded-md border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 p-3 font-mono text-xs text-[var(--pyre-red)]">
                {sendState.message}
              </p>
            )}
          </div>
        </section>

        {/* Rendered preview */}
        <section className="min-w-0 flex-1">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="font-mono text-xs uppercase tracking-wide text-white/40">Subject</span>
            <span className="truncate text-sm text-[var(--pyre-creme)]">
              {preview?.subject ?? '—'}
            </span>
          </div>
          <div className="overflow-hidden rounded-lg border border-white/10 bg-white/5">
            {preview ? (
              // Empty sandbox: styles render, scripts in the email HTML don't.
              <iframe
                title="Email preview"
                srcDoc={preview.html}
                sandbox=""
                className="h-[75vh] w-full border-0 bg-white"
              />
            ) : (
              <div className="flex h-[75vh] items-center justify-center font-mono text-xs uppercase tracking-wide text-white/30">
                {loading ? 'Rendering…' : 'No preview'}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
