// The form a board puts in front of people, filled in. One page or one
// question at a time, decided by the board; either way the questions are
// already resolved (lib/boards/forms.ts formQuestions) and the answers are
// posted keyed by question id.
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
import { answerOf, type FormConfig, type ResolvedQuestion } from '@/lib/boards/forms';
import { BOARD_LIMITS } from '@/lib/boards/types';
import type { BoardFieldValue } from '@/lib/db';

/** Mirrors HONEYPOT_FIELD in lib/boards/form-guard.ts, which is server-only. */
const HONEYPOT_FIELD = 'website';

type Answers = Record<string, BoardFieldValue | null | undefined>;

export interface BoardFormProps {
  slug: string;
  /** intro and confirmation are Markdown, rendered with the same component as card notes. */
  config: Pick<FormConfig, 'layout' | 'submitLabel' | 'intro' | 'confirmation'>;
  questions: ResolvedQuestion[];
  /** What the board calls a card — 'task', 'lead' — for the default thank-you. */
  noun: string;
  /** In the builder: never posts, shows the confirmation instead. */
  preview?: boolean;
}

export function BoardForm({ slug, config, questions, noun, preview = false }: BoardFormProps) {
  const [answers, setAnswers] = useState<Answers>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
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
    if (!stepped || step === 0) return;
    container.current
      ?.querySelector<HTMLElement>('input:not([tabindex="-1"]), textarea, select, button')
      ?.focus();
  }, [stepped, step]);

  const setAnswer = (question: ResolvedQuestion, value: BoardFieldValue | null) => {
    setAnswers((current) => ({ ...current, [question.id]: value }));
    if (problems[question.id]) {
      setProblems((current) => {
        const { [question.id]: _, ...rest } = current;
        return rest;
      });
    }
  };

  /** The questions still missing a required answer, by id. */
  const missing = (subset: ResolvedQuestion[], current: Answers = answers) =>
    Object.fromEntries(
      subset
        .filter(
          (question) => question.required && answerOf(question, current[question.id]) === null
        )
        .map((question) => [question.id, 'This one is needed.'])
    );

  const next = () => {
    const current = questions[step];
    const gaps = current ? missing([current]) : {};
    if (Object.keys(gaps).length > 0) {
      setProblems((existing) => ({ ...existing, ...gaps }));
      return;
    }
    setStep((s) => Math.min(s + 1, total - 1));
  };

  const back = () => setStep((s) => Math.max(s - 1, 0));

  /** Leave an optional question unanswered and move on; on the last, send. */
  const skip = (question: ResolvedQuestion) => {
    setAnswer(question, null);
    if (step < total - 1) setStep((s) => s + 1);
    else void submitAnswers({ ...answers, [question.id]: null });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
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
      setError('A few answers are still needed.');
      if (stepped) {
        const first = questions.findIndex((question) => gaps[question.id]);
        if (first >= 0) setStep(first);
      }
      return;
    }
    setError(null);
    if (preview) {
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
      const result = (await res.json()) as { confirmation?: string };
      setDone(result.confirmation ?? config.confirmation);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send this. Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (done !== null) {
    return (
      <div role="status">
        <SopMarkdown content={done || `Thanks, your ${noun} was sent.`} />
      </div>
    );
  }

  if (total === 0) {
    return <p className="text-sm text-white/60">This form has no questions yet.</p>;
  }

  const shown = stepped ? [questions[step]] : questions;
  const last = step === total - 1;

  // The intro is read once: on the one page, or on the first step.
  const showIntro = config.intro.trim() !== '' && (!stepped || step === 0);

  return (
    <form onSubmit={submit} noValidate>
      {showIntro && (
        <div className="mb-6">
          <SopMarkdown content={config.intro} />
        </div>
      )}
      <div ref={container} className="space-y-5">
        {shown.map((question) => (
          <QuestionRow
            key={question.id}
            question={question}
            value={answers[question.id]}
            problem={problems[question.id]}
            onChange={(value) => setAnswer(question, value)}
          />
        ))}
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
        {stepped ? (
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
  question,
  value,
  problem,
  onChange,
}: {
  question: ResolvedQuestion;
  value: BoardFieldValue | null | undefined;
  problem?: string;
  onChange: (value: BoardFieldValue | null) => void;
}) {
  const id = `form-${question.key}`;
  const note = problem && (
    <p role="alert" className="mt-1 text-sm text-[var(--pyre-red)]">
      {problem}
    </p>
  );

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

  return (
    <div>
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
