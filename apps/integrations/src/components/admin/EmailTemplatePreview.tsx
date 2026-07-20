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
}

interface EmailTemplatePreviewProps {
  templates: TemplateOption[];
  /** Session types with dedicated confirmation copy — preset chips. */
  confirmationSessionTypes: string[];
}

interface PreviewState {
  html: string;
  subject: string;
}

export function EmailTemplatePreview({
  templates,
  confirmationSessionTypes,
}: EmailTemplatePreviewProps) {
  const [selectedKey, setSelectedKey] = useState(templates[0]?.key ?? '');
  const [propsJson, setPropsJson] = useState(() =>
    JSON.stringify(templates[0]?.defaultProps ?? {}, null, 2)
  );
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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
  }, []);

  const selectTemplate = (option: TemplateOption) => {
    const json = JSON.stringify(option.defaultProps, null, 2);
    setSelectedKey(option.key);
    setPropsJson(json);
    void renderTemplate(option.key, json);
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

  const currentSessionType = (() => {
    if (selectedKey !== 'confirmation') return null;
    try {
      const props = JSON.parse(propsJson);
      return typeof props.sessionType === 'string' ? props.sessionType : null;
    } catch {
      return null;
    }
  })();

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* Template list */}
      <nav className="shrink-0 lg:w-56">
        <p className="mb-2 font-mono text-xs uppercase tracking-wide text-white/40">Templates</p>
        <ul className="flex flex-row flex-wrap gap-1 lg:flex-col">
          {templates.map((option) => (
            <li key={option.key}>
              <button
                type="button"
                onClick={() => selectTemplate(option)}
                className={`w-full rounded-md px-3 py-2 text-left font-mono text-xs uppercase tracking-wide transition-colors ${
                  option.key === selectedKey
                    ? 'bg-white/10 text-[var(--pyre-creme)]'
                    : 'text-white/50 hover:bg-white/5 hover:text-white/80'
                }`}
              >
                {option.key}
              </button>
            </li>
          ))}
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
  );
}
