// The form builder (/admin/boards/<slug>/form): what a board's form asks,
// how, and who may open it. Managers only, like board settings.
//
// Edited the way board settings are edited: every change is saved on its
// own after a moment, the whole question list at once, with the shared
// queue keeping edits made during a request. The server answers with the
// form as it finalized it, but the rules that span settings (finalizeForm)
// are run here first, so what the builder shows after switching the title
// mode is what the server will keep.
//
// The preview on the right is the real form island, told not to post.

import { useEffect, useMemo, useRef, useState } from 'react';
import { BoardForm } from '@/components/forms/BoardForm';
import {
  BUILTIN_LABELS,
  checkBackgroundFile,
  FORM_ACCESS,
  FORM_ACCESS_LABELS,
  FORM_BACKGROUND_ACCEPT,
  FORM_LAYOUT_LABELS,
  FORM_LAYOUTS,
  FORM_LIMITS,
  type FormBackground,
  type FormConfig,
  finalizeForm,
  formHref,
  formQuestions,
  formTitle,
  isBuiltin,
  questionId,
  renderTitle,
  TITLE_MODE_LABELS,
  TITLE_MODES,
} from '@/lib/boards/forms';
import { FIELD_KIND_LABELS } from '@/lib/boards/types';
import { useCachedJson } from '@/lib/client/cachedJson';
import type {
  BoardFieldRow,
  BoardFieldValue,
  BoardFormBuiltin,
  BoardFormQuestion,
  BoardRow,
} from '@/lib/db';
import { downscaleImage } from '@/lib/media/attachments';
import {
  buttonClass,
  cardClass,
  inputBaseClass,
  inputClass,
  labelClass,
  SectionTitle,
  selectBaseClass,
  send,
  textareaClass,
  toolbarButtonClass,
} from '../goalsUi';
import { Chip, readError } from '../incidentUi';
import { ColumnOrder } from './ColumnOrder';
import { useCardAutosave } from './useCardAutosave';

interface FormResponse {
  board: Pick<BoardRow, 'slug' | 'name' | 'card_noun' | 'archived'>;
  form: FormConfig;
  exists: boolean;
  background: FormBackground | null;
  fields: BoardFieldRow[];
}

export function FormBuilder({ slug }: { slug: string }) {
  const url = `/api/admin/board-forms?slug=${encodeURIComponent(slug)}`;
  const { data, error, loading } = useCachedJson<FormResponse>(url, { maxAgeMs: 0 });

  if (error) return <p className="text-sm text-[var(--pyre-red)]">{error}</p>;
  if (loading || !data) return <p className="text-sm text-white/50">Loading…</p>;
  return <Builder key={slug} slug={slug} initial={data} />;
}

interface QuestionItem {
  key: string;
  label: string;
  question: BoardFormQuestion;
}

function Builder({ slug, initial }: { slug: string; initial: FormResponse }) {
  const { board, fields } = initial;
  const noun = board.card_noun;
  const liveFields = useMemo(() => fields.filter((field) => !field.archived), [fields]);
  const fieldByKey = useMemo(() => new Map(fields.map((field) => [field.key, field])), [fields]);

  const [config, setConfig] = useState<FormConfig>(initial.form);
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  useEffect(() => setOrigin(window.location.origin), []);

  const [background, setBackground] = useState<FormBackground | null>(initial.background);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const uploadBackground = async (file: File) => {
    const problem = checkBackgroundFile(file);
    if (problem) {
      setUploadError(problem);
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      const body = new FormData();
      body.set('slug', slug);
      body.set('file', await downscaleImage(file));
      const res = await fetch('/api/admin/board-form-media', { method: 'POST', body });
      if (!res.ok) throw new Error(await readError(res));
      setBackground(((await res.json()) as { background: FormBackground }).background);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Could not upload that image');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const removeBackground = async () => {
    setUploadError(null);
    setUploading(true);
    try {
      await send(`/api/admin/board-form-media?slug=${encodeURIComponent(slug)}`, 'DELETE');
      setBackground(null);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Could not remove the image');
    } finally {
      setUploading(false);
    }
  };

  const update = (patch: Partial<FormConfig>) => setConfig((current) => ({ ...current, ...patch }));

  /** A whole-form change — the title mode — settled the way the server will settle it. */
  const settle = (patch: Partial<FormConfig>) =>
    setConfig((current) => {
      const merged = { ...current, ...patch };
      const result = finalizeForm(merged);
      return result.ok ? result.value : merged;
    });

  const autosave = useCardAutosave(async (patch) => {
    await send<FormResponse>('/api/admin/board-forms', 'PATCH', { slug, ...patch });
  });

  // Compare setting by setting so a label edit never resends the list.
  const snapshot = JSON.stringify(config);
  const previous = useRef(snapshot);
  const schedule = useRef(autosave.schedule);
  schedule.current = autosave.schedule;
  useEffect(() => {
    if (previous.current === snapshot) return;
    const before = JSON.parse(previous.current) as Record<string, unknown>;
    const after = JSON.parse(snapshot) as Record<string, unknown>;
    const patch = Object.fromEntries(
      Object.entries(after).filter(
        ([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key])
      )
    );
    previous.current = snapshot;
    schedule.current(patch);
  }, [snapshot]);

  const saving = autosave.status === 'pending' || autosave.status === 'saving';

  const items: QuestionItem[] = config.questions.map((question) => ({
    key: questionId(question),
    label: sourceLabel(question, fieldByKey),
    question,
  }));

  const setQuestion = (index: number, patch: Partial<BoardFormQuestion>) =>
    update({
      questions: config.questions.map((question, i) =>
        i === index ? { ...question, ...patch } : question
      ),
    });

  const removeQuestion = (index: number) =>
    update({ questions: config.questions.filter((_, i) => i !== index) });

  const asked = new Set(config.questions.map(questionId));
  const candidates: { id: string; label: string; question: BoardFormQuestion }[] = [
    ...liveFields
      .filter((field) => !asked.has(field.key))
      .map((field) => ({
        id: field.key,
        label: `${field.label} (${FIELD_KIND_LABELS[field.kind]})`,
        question: {
          kind: 'field' as const,
          key: field.key,
          label: null,
          hint: null,
          required: false,
        },
      })),
    ...(['notes', 'due_date'] as BoardFormBuiltin[])
      .filter((key) => !asked.has(`$${key}`))
      .map((key) => ({
        id: `$${key}`,
        label: `${BUILTIN_LABELS[key]} (built in)`,
        question: { kind: 'builtin' as const, key, label: null, hint: null, required: false },
      })),
  ];
  const [candidate, setCandidate] = useState('');
  const chosen = candidates.find((c) => c.id === candidate) ?? candidates[0];

  const addQuestion = () => {
    if (!chosen) return;
    update({ questions: [...config.questions, chosen.question] });
    setCandidate('');
  };

  const shareUrl = `${origin}${formHref(slug)}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The link is on screen to select by hand.
    }
  };

  const example = renderTitle(
    config.titleTemplate,
    sampleAnswers(liveFields),
    liveFields,
    `New ${noun}`
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <a className={toolbarButtonClass} href={`/admin/boards/${slug}`}>
            ← {board.name}
          </a>
        </div>

        <section className={cardClass}>
          <SectionTitle note={formHref(slug)}>Status</SectionTitle>
          <div className="mb-4">
            <label className={labelClass} htmlFor="form-title">
              Form title
            </label>
            <input
              id="form-title"
              className={inputClass}
              type="text"
              maxLength={FORM_LIMITS.title}
              placeholder={board.name}
              value={config.title}
              onChange={(e) => update({ title: e.target.value })}
            />
            <p className="mt-1 text-xs text-white/35">
              The heading on the form. Leave it blank to use the board's name.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
            />
            The form is open
          </label>
          <p className="mt-1 text-xs text-white/35">
            {config.enabled
              ? `A submission becomes a ${noun} in this board's first open column.`
              : 'Nobody can open the form until it is switched on.'}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              className={`${inputBaseClass} min-w-0 flex-1 font-mono`}
              type="text"
              readOnly
              value={shareUrl}
              aria-label="Link to the form"
              onFocus={(e) => e.target.select()}
            />
            <button type="button" className={buttonClass} onClick={copy}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <a className={buttonClass} href={formHref(slug)} target="_blank" rel="noreferrer">
              Open
            </a>
          </div>
        </section>

        <section className={cardClass}>
          <SectionTitle>Who can open it</SectionTitle>
          <div className="space-y-2">
            {FORM_ACCESS.map((access) => (
              <label key={access} className="flex items-start gap-2 text-sm text-white/80">
                <input
                  type="radio"
                  name="form-access"
                  className="mt-1"
                  checked={config.access === access}
                  onChange={() => update({ access })}
                />
                <span>
                  {FORM_ACCESS_LABELS[access]}
                  <span className="block text-xs text-white/35">
                    {access === 'public'
                      ? 'No sign-in. A hidden field, a timer, and a per-address limit keep bots out.'
                      : 'Visitors are sent to sign in first, and must hold a grant for this board.'}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className={cardClass}>
          <SectionTitle>How it is asked</SectionTitle>
          <div className="space-y-2">
            {FORM_LAYOUTS.map((layout) => (
              <label key={layout} className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="radio"
                  name="form-layout"
                  checked={config.layout === layout}
                  onChange={() => update({ layout })}
                />
                {FORM_LAYOUT_LABELS[layout]}
              </label>
            ))}
          </div>
        </section>

        <section className={cardClass}>
          <SectionTitle note={`what the ${noun} is called`}>Title</SectionTitle>
          <div className="space-y-2">
            {TITLE_MODES.map((mode) => (
              <label key={mode} className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="radio"
                  name="form-title-mode"
                  checked={config.titleMode === mode}
                  onChange={() =>
                    settle({
                      titleMode: mode,
                      // A template with nothing in it cannot be saved; start
                      // it with something a manager will want to replace.
                      titleTemplate:
                        mode === 'template' && !config.titleTemplate.trim()
                          ? `New ${noun}`
                          : config.titleTemplate,
                    })
                  }
                />
                {TITLE_MODE_LABELS[mode]}
              </label>
            ))}
          </div>
          {config.titleMode === 'template' && (
            <div className="mt-3">
              <label className={labelClass} htmlFor="form-title-template">
                Template
              </label>
              <input
                id="form-title-template"
                className={inputClass}
                type="text"
                maxLength={FORM_LIMITS.titleTemplate}
                value={config.titleTemplate}
                onChange={(e) => update({ titleTemplate: e.target.value })}
              />
              {liveFields.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {liveFields.map((field) => (
                    <Chip
                      key={field.key}
                      label={`{${field.key}}`}
                      selected={config.titleTemplate.includes(`{${field.key}}`)}
                      onClick={() =>
                        update({
                          titleTemplate: `${config.titleTemplate.trimEnd()} {${field.key}}`.trim(),
                        })
                      }
                    />
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs text-white/35">
                For example: <span className="text-white/60">{example}</span>
              </p>
            </div>
          )}
        </section>

        <section className={cardClass}>
          <SectionTitle note={`${config.questions.length} asked`}>Questions</SectionTitle>
          {items.length === 0 && <p className="mb-2 text-xs text-white/35">No questions yet.</p>}
          <ColumnOrder
            items={items}
            disabled={false}
            help="Drag the handles to reorder questions, or focus a handle and use the up and down arrow keys."
            onChange={(next) => update({ questions: next.map((item) => item.question) })}
          >
            {(item, index) => {
              const question = item.question;
              const isTitle = question.kind === 'builtin' && question.key === 'title';
              const field = question.kind === 'field' ? fieldByKey.get(question.key) : undefined;
              const gone = question.kind === 'field' && (!field || field.archived);
              const placeholder =
                question.kind === 'builtin'
                  ? isBuiltin(question.key)
                    ? BUILTIN_LABELS[question.key]
                    : question.key
                  : (field?.label ?? question.key);
              return (
                <div className="space-y-2 rounded border border-white/10 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-white/50">
                      {item.label}
                      {gone && <span className="ml-2 text-[var(--pyre-red)]">(retired)</span>}
                    </span>
                    <label className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-white/50">
                      <input
                        type="checkbox"
                        checked={isTitle || question.required}
                        disabled={isTitle}
                        onChange={(e) => setQuestion(index, { required: e.target.checked })}
                      />
                      required
                    </label>
                    {!isTitle && (
                      <button
                        type="button"
                        className="shrink-0 px-1 font-mono text-xs text-white/40 underline hover:text-[var(--pyre-red)]"
                        aria-label={`Remove ${item.label}`}
                        onClick={() => removeQuestion(index)}
                      >
                        remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input
                      className={inputClass}
                      type="text"
                      maxLength={FORM_LIMITS.questionLabel}
                      placeholder={placeholder}
                      value={question.label ?? ''}
                      aria-label={`Label for ${item.label}`}
                      onChange={(e) => setQuestion(index, { label: e.target.value || null })}
                    />
                    <input
                      className={inputClass}
                      type="text"
                      maxLength={FORM_LIMITS.questionHint}
                      placeholder={field?.hint || 'Hint shown under the question (optional)'}
                      value={question.hint ?? ''}
                      aria-label={`Hint for ${item.label}`}
                      onChange={(e) => setQuestion(index, { hint: e.target.value || null })}
                    />
                  </div>
                </div>
              );
            }}
          </ColumnOrder>
          {candidates.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <select
                className={`${selectBaseClass} min-w-0 flex-1`}
                aria-label="Question to add"
                value={chosen?.id ?? ''}
                onChange={(e) => setCandidate(e.target.value)}
              >
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <button type="button" className={buttonClass} onClick={addQuestion}>
                Add question
              </button>
            </div>
          )}
          <p className="mt-2 text-xs text-white/35">
            A question asks one of the board's fields, or the {noun}'s own notes or due date. Leave
            the label blank to use the field's. Add fields to the board from its settings.
          </p>
        </section>

        <section className={cardClass}>
          <SectionTitle note="optional">Background image</SectionTitle>
          {background && (
            <img
              src={background.url}
              alt=""
              className="mb-3 max-h-40 w-full rounded border border-white/10 object-cover"
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept={FORM_BACKGROUND_ACCEPT}
              className="sr-only"
              id="form-background-file"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadBackground(file);
              }}
            />
            <label htmlFor="form-background-file" className={`${buttonClass} cursor-pointer`}>
              {uploading ? 'Working…' : background ? 'Replace image' : 'Choose an image'}
            </label>
            {background && (
              <button
                type="button"
                className={buttonClass}
                disabled={uploading}
                onClick={() => void removeBackground()}
              >
                Remove
              </button>
            )}
          </div>
          {uploadError && (
            <p role="alert" className="mt-2 text-sm text-[var(--pyre-red)]">
              {uploadError}
            </p>
          )}
          <p className="mt-2 text-xs text-white/35">
            Shown behind the form, darkened so the questions stay readable. JPEG, PNG, WebP, or GIF,
            up to 10 MB; large photos are shrunk before they are sent.
          </p>
        </section>

        <section className={cardClass}>
          <SectionTitle>Words</SectionTitle>
          <div className="space-y-3">
            <div>
              <label className={labelClass} htmlFor="form-intro">
                Before the questions
              </label>
              <textarea
                id="form-intro"
                className={textareaClass}
                maxLength={FORM_LIMITS.intro}
                placeholder="Markdown is fine here."
                value={config.intro}
                onChange={(e) => update({ intro: e.target.value })}
              />
              <p className="mt-1 text-xs text-white/35">
                Markdown: headings, bold, lists, and links all render on the form.
              </p>
            </div>
            <div>
              <label className={labelClass} htmlFor="form-confirmation">
                After it is sent
              </label>
              <textarea
                id="form-confirmation"
                className={textareaClass}
                maxLength={FORM_LIMITS.confirmation}
                placeholder={`Thanks, your ${noun} was sent.`}
                value={config.confirmation}
                onChange={(e) => update({ confirmation: e.target.value })}
              />
              <p className="mt-1 text-xs text-white/35">Markdown here too.</p>
            </div>
            <div>
              <label className={labelClass} htmlFor="form-submit-label">
                Send button
              </label>
              <input
                id="form-submit-label"
                className={inputClass}
                type="text"
                maxLength={FORM_LIMITS.submitLabel}
                value={config.submitLabel}
                onChange={(e) => update({ submitLabel: e.target.value })}
              />
            </div>
          </div>
        </section>

        {autosave.error && (
          <p role="alert" className="text-sm text-[var(--pyre-red)]">
            {autosave.error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <p role="status" className="text-xs text-white/50">
            {autosave.error
              ? 'Changes could not be saved.'
              : saving
                ? 'Saving…'
                : 'All changes saved'}
          </p>
          {autosave.error && (
            <button type="button" className={buttonClass} onClick={() => void autosave.flush()}>
              Retry
            </button>
          )}
        </div>
      </div>

      <aside
        className={`${cardClass} relative overflow-hidden lg:sticky lg:top-20`}
        style={
          background
            ? {
                backgroundImage: `url("${background.url}")`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : undefined
        }
      >
        {background && <div aria-hidden="true" className="absolute inset-0 bg-black/60" />}
        <div className={background ? 'relative rounded bg-[var(--pyre-black)]/85 p-4' : undefined}>
          <SectionTitle
            note={
              <button
                type="button"
                className="underline hover:text-white"
                onClick={() => setPreviewKey((k) => k + 1)}
              >
                start over
              </button>
            }
          >
            Preview
          </SectionTitle>
          <h3 className="mb-5 text-xl font-semibold">{formTitle(config, board.name)}</h3>
          <BoardForm
            key={`${previewKey}-${config.layout}`}
            preview
            slug={slug}
            config={{
              layout: config.layout,
              submitLabel: config.submitLabel || 'Send',
              intro: config.intro,
              confirmation: config.confirmation,
            }}
            questions={formQuestions(config, fields)}
            noun={noun}
          />
        </div>
      </aside>
    </div>
  );
}

/** "Contact name · Short text", or "Notes · built in". */
function sourceLabel(question: BoardFormQuestion, fieldByKey: Map<string, BoardFieldRow>): string {
  if (question.kind === 'builtin') {
    return `${isBuiltin(question.key) ? BUILTIN_LABELS[question.key] : question.key} · built in`;
  }
  const field = fieldByKey.get(question.key);
  return field ? `${field.label} · ${FIELD_KIND_LABELS[field.kind]}` : question.key;
}

/** Something plausible in every field, so the title example reads like a title. */
function sampleAnswers(fields: BoardFieldRow[]): Record<string, BoardFieldValue> {
  const answers: Record<string, BoardFieldValue> = {};
  for (const field of fields) {
    switch (field.kind) {
      case 'number':
        answers[field.key] = 12;
        break;
      case 'yes_no':
        answers[field.key] = true;
        break;
      case 'choice':
        if (field.options[0]) answers[field.key] = field.options[0];
        break;
      case 'multi_choice':
        if (field.options.length > 0) answers[field.key] = field.options.slice(0, 2);
        break;
      case 'date':
        answers[field.key] = '2026-10-03';
        break;
      case 'time':
        answers[field.key] = '18:00';
        break;
      case 'time_range':
        answers[field.key] = ['18:00', '21:00'];
        break;
      default:
        answers[field.key] = field.label;
    }
  }
  return answers;
}
