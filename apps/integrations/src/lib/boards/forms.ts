// A board's form: the questions it asks, how it asks them, and what a
// submission becomes. Pure and client-safe — the builder, the form island,
// and the routes all read from here, so nothing in it may touch storage.
//
// A question is a pointer, not a thing: at a board field by key, or at one
// of the card's own columns (title, notes, due date) by name. The form
// stores the pointers and resolves them against the board's live fields
// whenever it is read (formQuestions), so a field archived after the form
// was built simply stops being asked — the same way a card's properties
// drop a key the board no longer has.
//
// Answers travel keyed by question id: the field key for a field, and
// '$title' / '$notes' / '$due_date' for a builtin. A field key cannot start
// with '$' (KEY_RE), so the two can share one object without colliding.

import type {
  BoardFieldRow,
  BoardFieldValue,
  BoardFormAccess,
  BoardFormBuiltin,
  BoardFormLayout,
  BoardFormQuestion,
  BoardFormRow,
  BoardFormTitleMode,
} from '@/lib/db';
import { isYmd, type ParseResult } from '@/lib/goals/validate';
import { BOARD_LIMITS, KEY_RE } from './types';
import { formatProperty, KIND_PROBLEMS, normalizeAnswer, normalizeProperties } from './validate';

export const FORM_LIMITS = {
  title: 120,
  titleTemplate: 300,
  intro: 2000,
  confirmation: 2000,
  submitLabel: 40,
  questionLabel: 60,
  questionHint: 200,
  /** Fields per board plus the three builtins, with room to spare. */
  questions: 40,
  /** People one form may wake; past this it is everybody, so say so instead. */
  notify: 20,
  doneLabel: 40,
  doneHref: 300,
} as const;

/** What may sit behind a form: an image, and not a large one. */
export const FORM_BACKGROUND_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;
export const FORM_BACKGROUND_MAX_BYTES = 10_485_760;
export const FORM_BACKGROUND_ACCEPT = FORM_BACKGROUND_TYPES.join(',');

/** Why a file cannot be the background, or null when it can. */
export function checkBackgroundFile(file: Pick<File, 'type' | 'size'>): string | null {
  const mime = file.type.toLowerCase().split(';')[0].trim();
  if (!(FORM_BACKGROUND_TYPES as readonly string[]).includes(mime)) {
    return `A background must be a JPEG, PNG, WebP, or GIF image, not ${file.type || 'an unknown type'}`;
  }
  if (file.size === 0) return 'That file is empty';
  if (file.size > FORM_BACKGROUND_MAX_BYTES) {
    return `That image is ${Math.round(file.size / 1_048_576)} MB; the limit is 10 MB`;
  }
  return null;
}

/** The image behind a form, as the API hands it to the builder and the page. */
export interface FormBackground {
  path: string;
  url: string;
}

export const FORM_BUILTINS = ['title', 'notes', 'due_date'] as const;

export function isBuiltin(value: unknown): value is BoardFormBuiltin {
  return typeof value === 'string' && (FORM_BUILTINS as readonly string[]).includes(value);
}

export const BUILTIN_LABELS: Record<BoardFormBuiltin, string> = {
  title: 'Title',
  notes: 'Notes',
  due_date: 'Due date',
};

export const FORM_ACCESS = ['public', 'admin'] as const;
export const FORM_LAYOUTS = ['single', 'stepped'] as const;
export const TITLE_MODES = ['ask', 'template'] as const;

export function isFormAccess(value: unknown): value is BoardFormAccess {
  return typeof value === 'string' && (FORM_ACCESS as readonly string[]).includes(value);
}

export function isFormLayout(value: unknown): value is BoardFormLayout {
  return typeof value === 'string' && (FORM_LAYOUTS as readonly string[]).includes(value);
}

export function isTitleMode(value: unknown): value is BoardFormTitleMode {
  return typeof value === 'string' && (TITLE_MODES as readonly string[]).includes(value);
}

export const FORM_ACCESS_LABELS: Record<BoardFormAccess, string> = {
  public: 'Anyone with the link',
  admin: 'Signed-in staff who can see this board',
};

export const FORM_LAYOUT_LABELS: Record<BoardFormLayout, string> = {
  single: 'One page',
  stepped: 'One question at a time',
};

export const TITLE_MODE_LABELS: Record<BoardFormTitleMode, string> = {
  ask: 'Ask for a title',
  template: 'Build the title from answers',
};

/** What the form page is headed: its own title, or the board's name. */
export function formTitle(form: Pick<FormConfig, 'title'>, boardName: string): string {
  return form.title.trim() || boardName;
}

/**
 * Where a form sends somebody when there is nowhere of its own to send
 * them: the front door of the website, which is also where the logo above
 * every form points.
 */
export const FORM_DONE_HREF = 'https://pyresauna.com';
export const FORM_DONE_LABEL = 'Back to pyresauna.com';

/**
 * Whether a link is one a form may point its button at: an https address,
 * or a path on this site. Everything else — a javascript: or data: URL
 * above all — is refused, because the manager writing it and the stranger
 * clicking it are not the same person.
 */
export function isSafeHref(href: string): boolean {
  const value = href.trim();
  if (!value) return false;
  // A path, but not '//host', which is an address in disguise.
  if (value.startsWith('/')) return !value.startsWith('//');
  return /^https:\/\/[^\s/?#]+/i.test(value);
}

/** The button under the thank-you: where it goes and what it says. */
export function formDoneLink(config: Pick<FormConfig, 'doneHref' | 'doneLabel'>): {
  href: string;
  label: string;
} {
  const href = isSafeHref(config.doneHref) ? config.doneHref.trim() : FORM_DONE_HREF;
  const label = config.doneLabel.trim();
  if (label) return { href, label };
  return { href, label: href === FORM_DONE_HREF ? FORM_DONE_LABEL : 'Continue' };
}

/** Where the form is filled in. */
export function formHref(slug: string): string {
  return `/forms/${slug}`;
}

/** Where the form is built. */
export function formBuilderHref(slug: string): string {
  return `/admin/boards/${slug}/form`;
}

/** The key an answer travels under: '$title' for a builtin, the field key otherwise. */
export function questionId(question: Pick<BoardFormQuestion, 'kind' | 'key'>): string {
  return question.kind === 'builtin' ? `$${question.key}` : question.key;
}

/** The form as the API and the builder pass it around. */
export interface FormConfig {
  enabled: boolean;
  /** The heading on the form page; blank means the board's name. */
  title: string;
  access: BoardFormAccess;
  layout: BoardFormLayout;
  titleMode: BoardFormTitleMode;
  titleTemplate: string;
  intro: string;
  confirmation: string;
  submitLabel: string;
  /**
   * Who a submission wakes, by roster address. Empty means everyone who can
   * view the board, which is what a form does until somebody narrows it.
   */
  notify: string[];
  /** Whether the thank-you celebrates with confetti. */
  confetti: boolean;
  /** Where the button under the thank-you goes; blank is the home page. */
  doneHref: string;
  /** What that button says; blank names where it goes. */
  doneLabel: string;
  questions: BoardFormQuestion[];
}

export type FormPatch = Partial<FormConfig>;

const TITLE_QUESTION: BoardFormQuestion = {
  kind: 'builtin',
  key: 'title',
  label: null,
  hint: null,
  required: true,
};

/**
 * A form nobody has built yet: headed with the board's name, switched off,
 * for staff, on one page, asking for a title and then every live field,
 * none of them required. The builder starts from this so the first thing a
 * manager sees is a working form to prune, not an empty list to fill.
 */
export function defaultFormConfig(
  fields: Pick<BoardFieldRow, 'key' | 'archived'>[],
  boardName = ''
): FormConfig {
  return {
    enabled: false,
    title: boardName.trim().slice(0, FORM_LIMITS.title),
    access: 'admin',
    layout: 'single',
    titleMode: 'ask',
    titleTemplate: '',
    intro: '',
    confirmation: '',
    submitLabel: 'Send',
    notify: [],
    confetti: false,
    doneHref: '',
    doneLabel: '',
    questions: [
      TITLE_QUESTION,
      ...fields
        .filter((field) => !field.archived)
        .map(
          (field): BoardFormQuestion => ({
            kind: 'field',
            key: field.key,
            label: null,
            hint: null,
            required: false,
          })
        ),
    ],
  };
}

export function formConfigOf(row: BoardFormRow): FormConfig {
  return {
    enabled: row.enabled,
    title: row.title ?? '',
    access: row.access,
    layout: row.layout,
    titleMode: row.title_mode,
    titleTemplate: row.title_template,
    intro: row.intro,
    confirmation: row.confirmation,
    submitLabel: row.submit_label,
    notify: Array.isArray(row.notify_emails) ? row.notify_emails : [],
    confetti: row.confetti === true,
    doneHref: row.done_href ?? '',
    doneLabel: row.done_label ?? '',
    questions: Array.isArray(row.questions) ? row.questions : [],
  };
}

function fail<T>(error: string): ParseResult<T> {
  return { ok: false, error };
}

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? undefined : trimmed;
}

/** Text that may be blank but may not be over the limit. */
function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > max ? undefined : trimmed;
}

/**
 * The addresses a form wakes, lowercased and deduplicated in the order they
 * were given. Only the shape is checked here; whether an address belongs to
 * somebody who can open the board is a question about the board, answered
 * by formNotifyError when the form is saved.
 */
function parseNotify(value: unknown): ParseResult<string[]> {
  if (!Array.isArray(value)) return fail('notify must be a list of addresses');
  const emails: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return fail('notify must be a list of addresses');
    const email = item.trim().toLowerCase();
    if (!email) continue;
    if (email.length > 320 || !email.includes('@')) return fail(`"${item}" is not an address`);
    if (!emails.includes(email)) emails.push(email);
  }
  if (emails.length > FORM_LIMITS.notify) {
    return fail(`A form can notify at most ${FORM_LIMITS.notify} people`);
  }
  return { ok: true, value: emails };
}

function parseQuestions(value: unknown): ParseResult<BoardFormQuestion[]> {
  if (!Array.isArray(value)) return fail('questions must be a list');
  if (value.length > FORM_LIMITS.questions) {
    return fail(`A form can ask at most ${FORM_LIMITS.questions} questions`);
  }

  const questions: BoardFormQuestion[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return fail('Each question must be an object');
    }
    const raw = item as Record<string, unknown>;
    if (raw.kind !== 'field' && raw.kind !== 'builtin') {
      return fail('A question is a field or a builtin');
    }
    if (raw.kind === 'builtin') {
      if (!isBuiltin(raw.key)) {
        return fail(`A builtin question must be one of ${FORM_BUILTINS.join(', ')}`);
      }
    } else if (typeof raw.key !== 'string' || !KEY_RE.test(raw.key)) {
      return fail('A field question must name a field by its key');
    }
    const key = raw.key as string;

    const label = optionalText(raw.label, FORM_LIMITS.questionLabel);
    if (label === undefined) {
      return fail(`A question label must be ${FORM_LIMITS.questionLabel} characters or fewer`);
    }
    const hint = optionalText(raw.hint, FORM_LIMITS.questionHint);
    if (hint === undefined) {
      return fail(`A question hint must be ${FORM_LIMITS.questionHint} characters or fewer`);
    }
    if (raw.required !== undefined && typeof raw.required !== 'boolean') {
      return fail('required must be true or false');
    }
    if (raw.multiple !== undefined && typeof raw.multiple !== 'boolean') {
      return fail('multiple must be true or false');
    }
    if (raw.future !== undefined && typeof raw.future !== 'boolean') {
      return fail('future must be true or false');
    }

    const question: BoardFormQuestion = {
      kind: raw.kind,
      key,
      label,
      hint,
      required: raw.required === true,
      // Only a field can take several answers, or insist on a date still to
      // come; a builtin never carries either flag.
      ...(raw.kind === 'field' && raw.multiple === true ? { multiple: true } : {}),
      ...(raw.kind === 'field' && raw.future === true ? { future: true } : {}),
    };
    const id = questionId(question);
    if (seen.has(id)) return fail(`"${key}" is asked twice`);
    seen.add(id);
    questions.push(question);
  }
  return { ok: true, value: questions };
}

/**
 * A PATCH body: each setting optional, each checked when present. The route
 * merges the result onto the saved form (or the default) and then runs
 * finalizeForm over the whole, which is where the rules that span settings
 * live — a title mode and a title question have to agree, and one request
 * may carry only one of them.
 */
export function parseFormPatch(body: Record<string, unknown>): ParseResult<FormPatch> {
  const patch: FormPatch = {};

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') return fail('enabled must be true or false');
    patch.enabled = body.enabled;
  }
  if (body.title !== undefined) {
    const title = boundedText(body.title, FORM_LIMITS.title);
    if (title === undefined) return fail(`title must be ${FORM_LIMITS.title} characters or fewer`);
    patch.title = title;
  }
  if (body.access !== undefined) {
    if (!isFormAccess(body.access)) return fail('access must be public or admin');
    patch.access = body.access;
  }
  if (body.layout !== undefined) {
    if (!isFormLayout(body.layout)) return fail('layout must be single or stepped');
    patch.layout = body.layout;
  }
  if (body.titleMode !== undefined) {
    if (!isTitleMode(body.titleMode)) return fail('titleMode must be ask or template');
    patch.titleMode = body.titleMode;
  }
  if (body.titleTemplate !== undefined) {
    const template = boundedText(body.titleTemplate, FORM_LIMITS.titleTemplate);
    if (template === undefined) {
      return fail(`titleTemplate must be ${FORM_LIMITS.titleTemplate} characters or fewer`);
    }
    patch.titleTemplate = template;
  }
  if (body.intro !== undefined) {
    const intro = boundedText(body.intro, FORM_LIMITS.intro);
    if (intro === undefined) return fail(`intro must be ${FORM_LIMITS.intro} characters or fewer`);
    patch.intro = intro;
  }
  if (body.confirmation !== undefined) {
    const confirmation = boundedText(body.confirmation, FORM_LIMITS.confirmation);
    if (confirmation === undefined) {
      return fail(`confirmation must be ${FORM_LIMITS.confirmation} characters or fewer`);
    }
    patch.confirmation = confirmation;
  }
  if (body.submitLabel !== undefined) {
    const label = boundedText(body.submitLabel, FORM_LIMITS.submitLabel);
    if (!label) return fail(`submitLabel must be 1–${FORM_LIMITS.submitLabel} characters`);
    patch.submitLabel = label;
  }
  if (body.notify !== undefined) {
    const notify = parseNotify(body.notify);
    if (!notify.ok) return notify;
    patch.notify = notify.value;
  }
  if (body.confetti !== undefined) {
    if (typeof body.confetti !== 'boolean') return fail('confetti must be true or false');
    patch.confetti = body.confetti;
  }
  if (body.doneHref !== undefined) {
    const href = boundedText(body.doneHref, FORM_LIMITS.doneHref);
    if (href === undefined) {
      return fail(`doneHref must be ${FORM_LIMITS.doneHref} characters or fewer`);
    }
    if (href && !isSafeHref(href)) {
      return fail('The button link must be an https address or a path on this site');
    }
    patch.doneHref = href;
  }
  if (body.doneLabel !== undefined) {
    const label = boundedText(body.doneLabel, FORM_LIMITS.doneLabel);
    if (label === undefined) {
      return fail(`doneLabel must be ${FORM_LIMITS.doneLabel} characters or fewer`);
    }
    patch.doneLabel = label;
  }
  if (body.questions !== undefined) {
    const questions = parseQuestions(body.questions);
    if (!questions.ok) return questions;
    patch.questions = questions.value;
  }

  if (Object.keys(patch).length === 0) return fail('Nothing to change');
  return { ok: true, value: patch };
}

/**
 * The rules that only hold over a whole form. Asking for a title means a
 * required Title question, first if it has to be added; building the title
 * means no Title question and a template with something in it.
 */
export function finalizeForm(config: FormConfig): ParseResult<FormConfig> {
  const others = config.questions.filter(
    (question) => !(question.kind === 'builtin' && question.key === 'title')
  );
  if (config.titleMode === 'template') {
    if (!config.titleTemplate.trim()) {
      return fail('Give the title a template, or ask for a title instead');
    }
    return { ok: true, value: { ...config, questions: others } };
  }

  const existing = config.questions.find(
    (question) => question.kind === 'builtin' && question.key === 'title'
  );
  const title: BoardFormQuestion = existing ? { ...existing, required: true } : TITLE_QUESTION;
  const index = existing ? config.questions.indexOf(existing) : 0;
  const questions = [...others];
  questions.splice(index, 0, title);
  return { ok: true, value: { ...config, questions } };
}

/** The field keys a template names, in order of first appearance. */
export function templateKeys(template: string): string[] {
  const keys: string[] = [];
  for (const match of template.matchAll(/\{([a-z][a-z0-9_]{1,39})\}/g)) {
    if (!keys.includes(match[1])) keys.push(match[1]);
  }
  return keys;
}

/**
 * Whether the form points at anything the board does not have. Checked when
 * the form is saved, so the builder hears about a stale key straight away;
 * formQuestions is more forgiving for a form that was right when it was
 * saved and drifted since.
 */
export function formFieldError(
  config: Pick<FormConfig, 'questions' | 'titleMode' | 'titleTemplate'>,
  fields: Pick<BoardFieldRow, 'key' | 'archived'>[]
): string | null {
  const live = new Set(fields.filter((field) => !field.archived).map((field) => field.key));
  for (const question of config.questions) {
    if (question.kind === 'field' && !live.has(question.key)) {
      return `"${question.key}" is not a field on this board`;
    }
  }
  if (config.titleMode === 'template') {
    for (const key of templateKeys(config.titleTemplate)) {
      if (!live.has(key))
        return `The title template names "${key}", which is not a field on this board`;
    }
  }
  return null;
}

/**
 * Whether the form names somebody who cannot open the board, or null when
 * everyone it names can. A form decides who hears about a card on a board;
 * it may not decide who hears about a board they were never given.
 */
export function formNotifyError(
  config: Pick<FormConfig, 'notify'>,
  candidates: { email: string }[]
): string | null {
  const allowed = new Set(candidates.map((person) => person.email.trim().toLowerCase()));
  for (const email of config.notify) {
    if (!allowed.has(email)) return `"${email}" cannot open this board`;
  }
  return null;
}

/**
 * Who a submission wakes: the people the form names, if it names any, and
 * otherwise everyone holding the board. Either way it is intersected with
 * the board's holders as they stand now, so a form that named somebody who
 * has since lost the board quietly stops waking them.
 */
export function notifyRecipients(notify: string[], holders: string[]): string[] {
  if (notify.length === 0) return holders;
  const named = new Set(notify.map((email) => email.trim().toLowerCase()));
  return holders.filter((email) => named.has(email.trim().toLowerCase()));
}

/** A question with its pointer followed: the label to show and the kind to ask in. */
export interface ResolvedQuestion {
  id: string;
  kind: 'field' | 'builtin';
  key: string;
  label: string;
  hint: string | null;
  required: boolean;
  /** A date question that takes more than one date; every other question is one answer. */
  multiple: boolean;
  /** A date question that refuses a date already gone. */
  future: boolean;
  /** The field's shape, for a field question; null for a builtin. */
  field: Pick<BoardFieldRow, 'kind' | 'options'> | null;
}

/**
 * The questions as they will be asked, in order. A field question whose
 * field is gone or archived is skipped; the Title question is asked only
 * when the form asks for a title, and always required when it is; the
 * form's own label and hint win over the field's.
 */
export function formQuestions(
  form: Pick<FormConfig, 'questions' | 'titleMode'>,
  fields: Pick<BoardFieldRow, 'key' | 'label' | 'kind' | 'options' | 'hint' | 'archived'>[]
): ResolvedQuestion[] {
  const byKey = new Map(
    fields.filter((field) => !field.archived).map((field) => [field.key, field])
  );
  const seen = new Set<string>();
  const resolved: ResolvedQuestion[] = [];

  for (const question of form.questions) {
    const id = questionId(question);
    if (seen.has(id)) continue;

    if (question.kind === 'builtin') {
      if (!isBuiltin(question.key)) continue;
      if (question.key === 'title' && form.titleMode !== 'ask') continue;
      seen.add(id);
      resolved.push({
        id,
        kind: 'builtin',
        key: question.key,
        label: question.label ?? BUILTIN_LABELS[question.key],
        hint: question.hint,
        required: question.key === 'title' || question.required,
        multiple: false,
        future: false,
        field: null,
      });
      continue;
    }

    const field = byKey.get(question.key);
    if (!field) continue;
    seen.add(id);
    resolved.push({
      id,
      kind: 'field',
      key: question.key,
      label: question.label ?? field.label,
      hint: question.hint ?? field.hint,
      required: question.required,
      multiple: field.kind === 'date' && question.multiple === true,
      future: field.kind === 'date' && question.future === true,
      field: { kind: field.kind, options: field.options },
    });
  }

  // A form that asks for a title has to ask for it somewhere, even if the
  // saved list somehow lost the question.
  if (form.titleMode === 'ask' && !seen.has('$title')) {
    resolved.unshift({
      id: '$title',
      kind: 'builtin',
      key: 'title',
      label: BUILTIN_LABELS.title,
      hint: null,
      required: true,
      multiple: false,
      future: false,
      field: null,
    });
  }
  return resolved;
}

/**
 * One answer as it would be stored, or null when there is nothing usable in
 * it. A field answer takes its field's shape; a title or notes is trimmed
 * text; a due date is a YYYY-MM-DD. This is what "answered" means for a
 * required question: `false` answers a yes/no, an empty pick-any does not.
 */
export function answerOf(question: ResolvedQuestion, raw: unknown): BoardFieldValue | null {
  if (question.field) {
    if (raw === null || raw === undefined) return null;
    const answer = normalizeAnswer(question.field, raw);
    // A date question asked for one date takes one, whatever the client
    // sent: the first, since that is the one the person picked first.
    if (question.field.kind === 'date' && !question.multiple && Array.isArray(answer)) {
      return answer[0] ?? null;
    }
    return answer;
  }
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  switch (question.key) {
    case 'title':
      return value.slice(0, BOARD_LIMITS.title);
    case 'notes':
      return value.slice(0, BOARD_LIMITS.notes);
    case 'due_date':
      return isYmd(value) ? value : null;
    default:
      return null;
  }
}

export function isAnswered(question: ResolvedQuestion, raw: unknown): boolean {
  return answerOf(question, raw) !== null;
}

/**
 * Today on the bathhouse's own clock, as YYYY-MM-DD. A form is filled in
 * from wherever somebody happens to be, and "already gone" has to mean the
 * same thing to the sender and to the board, so both read it in New York —
 * the same wall clock a card's due date is read against.
 */
export function todayEastern(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** The dates in an answer, however many the question takes. */
function datesIn(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string');
  return typeof raw === 'string' ? [raw] : [];
}

/** Nothing was typed here, whatever shape the control hands back. */
export function isBlankAnswer(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw === 'string') return raw.trim() === '';
  if (Array.isArray(raw)) return raw.length === 0;
  return false;
}

/**
 * What to say about an answer, or null when there is nothing to say. Two
 * different silences: a required question nobody filled in, and a question
 * somebody did fill in with something its kind cannot hold. The second only
 * speaks for the kinds whose whole point is the check — an address that is
 * not an address is a typo worth catching, while a pick-one whose option
 * the board has since dropped is our mess, not the sender's, and is quietly
 * left behind the way it always was.
 */
export function answerProblem(
  question: ResolvedQuestion,
  raw: unknown,
  today = todayEastern()
): string | null {
  const answer = answerOf(question, raw);
  if (answer !== null) {
    // A date the question insists is still to come. Checked on the answer
    // rather than on what was typed, so it reads whatever the control sent:
    // one date or several, and today counts as still to come.
    if (question.future) {
      const past = datesIn(answer).filter((date) => date < today);
      if (past.length > 0) {
        return past.length === 1 && datesIn(answer).length === 1
          ? 'That date has already passed.'
          : 'Those dates have to be today or later.';
      }
    }
    return null;
  }
  if (!isBlankAnswer(raw) && question.field) {
    const problem = KIND_PROBLEMS[question.field.kind];
    if (problem) return problem;
  }
  return question.required ? 'This one is needed.' : null;
}

/**
 * "Rental request from {contact_name}" with the answers filled in. A key
 * the board does not have, or one nobody answered, becomes nothing; the
 * result is squeezed to one line and, if that leaves nothing, the fallback.
 */
export function renderTitle(
  template: string,
  answers: Record<string, unknown>,
  fields: Pick<BoardFieldRow, 'key' | 'kind' | 'options'>[],
  fallback: string
): string {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const filled = template.replace(/\{([a-z][a-z0-9_]{1,39})\}/g, (_, key: string) => {
    const field = byKey.get(key);
    if (!field) return '';
    const raw = answers[key];
    const value = raw === null || raw === undefined ? null : normalizeAnswer(field, raw);
    return value === null ? '' : formatProperty(field, value);
  });
  const title = filled.replace(/\s+/g, ' ').trim().slice(0, BOARD_LIMITS.title).trim();
  return title || fallback;
}

/** What a submission becomes: the card's own columns and its answers. */
export interface Submission {
  title: string;
  notes_md: string;
  due_date: string | null;
  properties: Record<string, BoardFieldValue>;
}

/**
 * A submission checked against the form as it is asked today. Every required
 * question needs an answer; an answer to a question the form does not ask is
 * dropped, so a hidden field cannot be written through the form's door.
 */
export function parseSubmission(
  form: FormConfig,
  fields: BoardFieldRow[],
  body: Record<string, unknown>,
  fallbackTitle: string
): ParseResult<Submission> {
  const raw = body.answers;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('answers must be an object');
  }
  const answers = raw as Record<string, unknown>;
  const questions = formQuestions(form, fields);

  const fieldAnswers: Record<string, unknown> = {};
  let title = '';
  let notes = '';
  let dueDate: string | null = null;

  for (const question of questions) {
    const raw = answers[question.id];
    // Whatever the client should already have said: a missing required
    // answer, an address that is not one, a date that has gone. This is the
    // door closing on anything that went around the form.
    const problem = answerProblem(question, raw);
    if (problem) {
      if (question.required && isBlankAnswer(raw)) return fail(`"${question.label}" is required`);
      return fail(`"${question.label}": ${problem}`);
    }
    const value = answerOf(question, raw);
    if (value === null) continue;
    if (question.kind === 'field') fieldAnswers[question.key] = value;
    else if (question.key === 'title') title = String(value);
    else if (question.key === 'notes') notes = String(value);
    else if (question.key === 'due_date') dueDate = String(value);
  }

  const asked = new Set(questions.filter((q) => q.kind === 'field').map((q) => q.key));
  const properties = normalizeProperties(
    fields.filter((field) => asked.has(field.key)),
    fieldAnswers
  );

  if (form.titleMode === 'template') {
    title = renderTitle(form.titleTemplate, fieldAnswers, fields, fallbackTitle);
  } else if (!title) {
    title = fallbackTitle;
  }

  return { ok: true, value: { title, notes_md: notes, due_date: dueDate, properties } };
}
