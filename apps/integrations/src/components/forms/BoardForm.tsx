// The form a board puts in front of people, filled in. One page or one
// question at a time, decided by the board; either way the questions are
// already resolved (lib/boards/forms.ts formQuestions) and the answers are
// posted keyed by question id.
//
// One question at a time opens on a cover: the intro, if there is one, and
// a Next. Nobody is asked anything until they have chosen to start, and the
// first question is not mistaken for the whole form. Each step is keyed by
// its index, so arriving at one remounts it and the .form-step animation in
// styles/admin.css plays — in from the right going forward, from the left
// going back, and not at all under a reduced-motion preference.
//
// A field question is asked with the same control the card drawer uses
// (FieldInput), so an answer given here looks the same on the card as one
// typed by staff. The yes/no control draws its own label, so that one is
// mounted bare, the way FieldRow does it.
//
// The honeypot and the clock are the public form's only proof of a person:
// a hidden field nobody sees, and the time the page was opened, both sent
// with the answers and checked on the server (lib/boards/form-guard.ts).

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { FilesField } from '@/components/admin/boards/FilesField';
import {
  buttonClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  textareaClass,
} from '@/components/admin/goalsUi';
import { FieldInput } from '@/components/admin/guestUi';
import { readError } from '@/components/admin/incidentUi';
import { SopMarkdown } from '@/components/admin/SopMarkdown';
import { fileIdsOf, formMediaHref } from '@/lib/boards/files';
import {
  answerProblem,
  type FormConfig,
  formDoneLink,
  isBlankAnswer,
  type ResolvedQuestion,
  todayEastern,
} from '@/lib/boards/forms';
import { BOARD_LIMITS } from '@/lib/boards/types';
import type { BoardFieldValue } from '@/lib/db';
import { Confetti } from './Confetti';

/** Mirrors HONEYPOT_FIELD in lib/boards/form-guard.ts, which is server-only. */
const HONEYPOT_FIELD = 'website';

type Answers = Record<string, BoardFieldValue | null | undefined>;

export interface BoardFormProps {
  slug: string;
  /** intro and confirmation are Markdown, rendered with the same component as card notes. */
  config: Pick<
    FormConfig,
    'layout' | 'submitLabel' | 'intro' | 'confirmation' | 'confetti' | 'doneHref' | 'doneLabel'
  >;
  questions: ResolvedQuestion[];
  /** What the board calls a card — 'task', 'lead' — for the default thank-you. */
  noun: string;
  /** In the builder: never posts, shows the confirmation instead. */
  preview?: boolean;
}

export function BoardForm({ slug, config, questions, noun, preview = false }: BoardFormProps) {
  const [answers, setAnswers] = useState<Answers>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  // One question at a time starts on the cover; the first question waits
  // behind its Next.
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  /** Whether the thank-you pops. The server's answer wins, so a form switched
   *  off while somebody was filling it in does not celebrate. */
  const [celebrate, setCelebrate] = useState(config.confetti);
  // Which way the last step moved, so its animation comes from that side.
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [website, setWebsite] = useState('');
  // Set on the client after mount, so the server and the browser paint the
  // same markup and the clock still says when a person opened the page.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  useEffect(() => setStartedAt(Date.now()), []);

  const stepped = config.layout === 'stepped';
  const total = questions.length;
  const container = useRef<HTMLDivElement>(null);

  // Each step lands on its own question.
  useEffect(() => {
    if (!stepped || !started) return;
    container.current
      ?.querySelector<HTMLElement>('input:not([tabindex="-1"]), textarea, select, button')
      ?.focus();
  }, [stepped, started, step]);

  const setAnswer = (question: ResolvedQuestion, value: BoardFieldValue | null) => {
    setAnswers((current) => ({ ...current, [question.id]: value }));
    if (problems[question.id]) {
      setProblems((current) => {
        const { [question.id]: _, ...rest } = current;
        return rest;
      });
    }
  };

  /**
   * What is still wrong, by question id: an answer that is needed and
   * missing, or one that was given in a shape its question cannot hold —
   * an address that is not an address (lib/boards/forms answerProblem).
   */
  const missing = (subset: ResolvedQuestion[], current: Answers = answers) =>
    Object.fromEntries(
      subset
        .map((question) => [question.id, answerProblem(question, current[question.id])] as const)
        .filter((entry): entry is readonly [string, string] => entry[1] !== null)
    );

  /**
   * Leaving a question: say straight away if what was typed cannot be what
   * the question asked for — an address that is not one, a date that has
   * gone. A question nobody has answered yet says nothing, because tabbing
   * past something optional is not a mistake and being told it is needed
   * before you have reached the end is nagging. Send has the last word.
   */
  const check = (question: ResolvedQuestion) => {
    const raw = answers[question.id];
    if (isBlankAnswer(raw)) return;
    const problem = answerProblem(question, raw);
    setProblems((current) => {
      if (problem) return { ...current, [question.id]: problem };
      if (!current[question.id]) return current;
      const { [question.id]: _, ...rest } = current;
      return rest;
    });
  };

  const next = () => {
    const current = questions[step];
    const gaps = current ? missing([current]) : {};
    if (Object.keys(gaps).length > 0) {
      setProblems((existing) => ({ ...existing, ...gaps }));
      return;
    }
    setDirection('forward');
    setStep((s) => Math.min(s + 1, total - 1));
  };

  const back = () => {
    setDirection('back');
    setStep((s) => Math.max(s - 1, 0));
  };

  /** Leave an optional question unanswered and move on; on the last, send. */
  const skip = (question: ResolvedQuestion) => {
    setAnswer(question, null);
    setDirection('forward');
    if (step < total - 1) setStep((s) => s + 1);
    else void submitAnswers({ ...answers, [question.id]: null });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (stepped && !started) {
      setDirection('forward');
      setStarted(true);
      return;
    }
    if (stepped && step < total - 1) {
      next();
      return;
    }
    await submitAnswers(answers);
  };

  const submitAnswers = async (current: Answers) => {
    const gaps = missing(questions, current);
    if (Object.keys(gaps).length > 0) {
      setProblems(gaps);
      setError('A few answers still need a look.');
      if (stepped) {
        const first = questions.findIndex((question) => gaps[question.id]);
        if (first >= 0) {
          setDirection(first < step ? 'back' : 'forward');
          setStep(first);
        }
      }
      return;
    }
    setError(null);
    if (preview) {
      // The builder's preview never posts, so it reads the settings as they
      // stand rather than as they stood when it mounted.
      setCelebrate(config.confetti);
      setDone(config.confirmation);
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/forms/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: current, startedAt, [HONEYPOT_FIELD]: website }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const result = (await res.json()) as { confirmation?: string; confetti?: boolean };
      setCelebrate(result.confetti ?? config.confetti);
      setDone(result.confirmation ?? config.confirmation);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send this. Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (done !== null) {
    // A form is a dead end without this: the thank-you always ends in a way
    // out, the form's own or the front door.
    const onward = formDoneLink(config);
    return (
      <div role="status">
        {celebrate && <Confetti />}
        <SopMarkdown content={done || `Thanks, your ${noun} was sent.`} />
        <div className="mt-6 flex">
          {preview ? (
            // The builder's preview shows the button without offering to
            // leave the builder by it.
            <span className={primaryButtonClass}>{onward.label}</span>
          ) : (
            <a className={primaryButtonClass} href={onward.href}>
              {onward.label}
            </a>
          )}
        </div>
      </div>
    );
  }

  if (total === 0) {
    return <p className="text-sm text-white/60">This form has no questions yet.</p>;
  }

  const cover = stepped && !started;
  const shown = cover ? [] : stepped ? [questions[step]] : questions;
  const last = step === total - 1;

  // The intro is read once: on the one page, or on the cover.
  const showIntro = config.intro.trim() !== '' && (!stepped || cover);

  return (
    <form onSubmit={submit} noValidate>
      {showIntro && (
        <div className="mb-6">
          <SopMarkdown content={config.intro} />
        </div>
      )}
      {/* {cover && (
        <p className="text-sm text-white/60">
          {total === 1 ? 'One question.' : `${total} questions.`}
        </p>
      )} */}
      <div ref={container}>
        {/* Keyed by the step so each question arrives as a new element and
            animates in — the cover counts as its own, so the first question
            enters like the rest. The one page is one element that never
            changes. The gap between questions lives here, on whichever of
            the two is holding them. */}
        <div
          key={stepped ? (started ? `q${step}` : 'cover') : 'all'}
          className={stepped ? 'form-step space-y-5' : 'space-y-5'}
          data-direction={stepped ? direction : undefined}
        >
          {shown.map((question) => (
            <QuestionRow
              key={question.id}
              slug={slug}
              question={question}
              value={answers[question.id]}
              problem={problems[question.id]}
              preview={preview}
              onChange={(value) => setAnswer(question, value)}
              onLeave={() => check(question)}
            />
          ))}
        </div>
      </div>

      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input
            type="text"
            name={HONEYPOT_FIELD}
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-[var(--pyre-red)]">
          {error}
        </p>
      )}

      <div className="mt-6 flex items-center justify-between gap-3">
        {cover ? (
          <button type="submit" className={`${primaryButtonClass} ml-auto`}>
            Next
          </button>
        ) : stepped ? (
          <>
            <button type="button" className={buttonClass} onClick={back} disabled={step === 0}>
              Back
            </button>
            <p role="status" className="font-mono text-xs text-white/50">
              {step + 1} of {total}
            </p>
            <span className="flex items-center gap-2">
              {!questions[step].required && (
                <button
                  type="button"
                  className={buttonClass}
                  disabled={sending}
                  onClick={() => skip(questions[step])}
                >
                  Skip
                </button>
              )}
              <button type="submit" className={primaryButtonClass} disabled={sending}>
                {last ? (sending ? 'Sending…' : config.submitLabel) : 'Next'}
              </button>
            </span>
          </>
        ) : (
          <button type="submit" className={`${primaryButtonClass} ml-auto`} disabled={sending}>
            {sending ? 'Sending…' : config.submitLabel}
          </button>
        )}
      </div>
    </form>
  );
}

function QuestionRow({
  slug,
  question,
  value,
  problem,
  preview,
  onChange,
  onLeave,
}: {
  slug: string;
  question: ResolvedQuestion;
  value: BoardFieldValue | null | undefined;
  problem?: string;
  preview: boolean;
  onChange: (value: BoardFieldValue | null) => void;
  /** Focus has left this question: check what was typed. */
  onLeave: () => void;
}) {
  const id = `form-${question.key}`;
  const note = problem && (
    <p role="alert" className="mt-1 text-sm text-[var(--pyre-red)]">
      {problem}
    </p>
  );

  if (question.field?.kind === 'files') {
    // Uploads go to the form's own door (api/forms/[slug]/media), staged
    // until the submission naming them lands. A file picked and then
    // un-picked is deleted there; nothing here can read one back.
    const media = formMediaHref(slug);
    return (
      <div>
        <label className={labelClass} htmlFor={id}>
          {question.label}
          {question.required && (
            <span className="ml-1.5 normal-case tracking-normal text-white/35">(required)</span>
          )}
        </label>
        {question.hint && <p className="-mt-1 mb-2 text-xs text-white/40">{question.hint}</p>}
        <FilesField
          id={id}
          label={question.label}
          value={fileIdsOf(value)}
          action={media}
          params={{ field: question.key }}
          preview={preview}
          unpick={async (fileId) => {
            await fetch(`${media}?id=${encodeURIComponent(fileId)}`, { method: 'DELETE' });
          }}
          onChange={onChange}
        />
        {note}
      </div>
    );
  }

  if (question.field?.kind === 'yes_no') {
    return (
      <div>
        <FieldInput
          idPrefix="form"
          field={{
            key: question.key,
            label: question.label,
            kind: 'yes_no',
            options: [],
            hint: question.hint,
          }}
          value={value}
          onChange={onChange}
        />
        {question.required && <p className="mt-1 text-xs text-white/35">Required</p>}
        {note}
      </div>
    );
  }

  // onBlur on the wrapper rather than on each control: React's version of it
  // bubbles, so one handler covers the picker, the textarea, and the several
  // inputs a date or a time range is made of.
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Focus leaving the field, not a mouse affordance: onBlur adds nothing a keyboard cannot reach.
    <div onBlur={onLeave}>
      <label className={labelClass} htmlFor={id}>
        {question.label}
        {question.required && (
          <span className="ml-1.5 normal-case tracking-normal text-white/35">(required)</span>
        )}
      </label>
      {question.hint && <p className="-mt-1 mb-2 text-xs text-white/40">{question.hint}</p>}
      {question.field ? (
        <FieldInput
          idPrefix="form"
          field={{
            key: question.key,
            label: question.label,
            kind: question.field.kind,
            options: question.field.options,
            hint: question.hint,
          }}
          value={value}
          multiple={question.multiple}
          // A question that insists on a date still to come greys out the
          // past in the picker; answerProblem is what actually refuses it.
          min={question.future ? todayEastern() : undefined}
          onChange={onChange}
        />
      ) : question.key === 'notes' ? (
        <textarea
          id={id}
          className={textareaClass}
          maxLength={BOARD_LIMITS.notes}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      ) : question.key === 'due_date' ? (
        <input
          id={id}
          className={inputClass}
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      ) : (
        <input
          id={id}
          className={inputClass}
          type="text"
          maxLength={BOARD_LIMITS.title}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      )}
      {note}
    </div>
  );
}
