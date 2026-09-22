import { describe, expect, it } from 'vitest';
import type { BoardFieldRow, BoardFormRow } from '@/lib/db';
import type { ParseResult } from '@/lib/goals/validate';
import {
  answerOf,
  answerProblem,
  defaultFormConfig,
  FORM_DONE_HREF,
  FORM_DONE_LABEL,
  type FormConfig,
  finalizeForm,
  formConfigOf,
  formDoneLink,
  formFieldError,
  formHref,
  formNotifyError,
  formQuestions,
  formTitle,
  isAnswered,
  isBlankAnswer,
  notifyRecipients,
  parseFormPatch,
  parseSubmission,
  questionId,
  type ResolvedQuestion,
  renderTitle,
  templateKeys,
} from './forms';
import { KIND_PROBLEMS } from './validate';

function value<T>(result: ParseResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.value;
}

function error<T>(result: ParseResult<T>): string {
  if (result.ok) throw new Error('expected an error');
  return result.error;
}

function field(overrides: Partial<BoardFieldRow> & Pick<BoardFieldRow, 'key'>): BoardFieldRow {
  return {
    id: overrides.key,
    board_id: 'board',
    label: overrides.key,
    kind: 'text',
    options: [],
    hint: null,
    show_on_card: false,
    show_label_on_card: true,
    show_on_calendar: false,
    calendar_time_key: null,
    sort_order: 10,
    archived: false,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

const contactName = field({ key: 'contact_name', label: 'Contact name' });
const partySize = field({ key: 'party_size', label: 'Party size', kind: 'number' });
const occasion = field({
  key: 'occasion',
  label: 'Occasion',
  kind: 'choice',
  options: ['Birthday', 'Team outing'],
});
const extras = field({
  key: 'extras',
  label: 'Extras',
  kind: 'multi_choice',
  options: ['Towels', 'Cold plunge'],
});
const catering = field({ key: 'catering', label: 'Catering?', kind: 'yes_no' });
const window = field({ key: 'window', label: 'Window', kind: 'time_range' });
const retired = field({ key: 'retired', label: 'Retired', archived: true });
const fields = [contactName, partySize, occasion, extras, catering, window, retired];

const base: FormConfig = {
  enabled: true,
  title: '',
  access: 'public',
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
    { kind: 'builtin', key: 'title', label: null, hint: null, required: true },
    { kind: 'field', key: 'contact_name', label: null, hint: null, required: true },
    { kind: 'field', key: 'party_size', label: 'How many?', hint: 'Roughly', required: false },
    { kind: 'field', key: 'catering', label: null, hint: null, required: false },
  ],
};

describe('questionId and hrefs', () => {
  it('prefixes builtins so they never collide with a field key', () => {
    expect(questionId({ kind: 'builtin', key: 'title' })).toBe('$title');
    expect(questionId({ kind: 'field', key: 'title' })).toBe('title');
  });

  it('points at the form and the builder', () => {
    expect(formHref('rentals')).toBe('/forms/rentals');
  });

  it('heads the page with the form title, or the board name when blank', () => {
    expect(formTitle({ title: 'Book a rental' }, 'Rental & group leads')).toBe('Book a rental');
    expect(formTitle({ title: '  ' }, 'Rental & group leads')).toBe('Rental & group leads');
  });
});

describe('defaultFormConfig', () => {
  it('is headed with the board name and asks for a title, then every live field', () => {
    const config = defaultFormConfig(fields, ' Rental & group leads ');
    expect(config.enabled).toBe(false);
    expect(config.title).toBe('Rental & group leads');
    expect(config.access).toBe('admin');
    expect(config.questions[0]).toMatchObject({ kind: 'builtin', key: 'title', required: true });
    expect(config.questions.map((q) => q.key)).not.toContain('retired');
    expect(config.questions.slice(1).every((q) => !q.required)).toBe(true);
    expect(config.notify).toEqual([]);
    expect(config.confetti).toBe(false);
    expect(config.doneHref).toBe('');
    expect(config.doneLabel).toBe('');
  });

  it('reads a row back into camelCase', () => {
    const row = {
      id: 'form',
      board_id: 'board',
      enabled: true,
      title: 'Book a rental',
      access: 'public',
      layout: 'stepped',
      title_mode: 'template',
      title_template: 'Hi {contact_name}',
      intro: 'Welcome',
      confirmation: 'Thanks',
      submit_label: 'Go',
      background_path: null,
      notify_emails: ['DANA@pyresauna.com'.toLowerCase()],
      confetti: true,
      done_href: '/admin/boards',
      done_label: 'Open the board',
      questions: base.questions,
      created_by: null,
      updated_by: null,
      created_at: '',
      updated_at: '',
    } satisfies BoardFormRow;
    expect(formConfigOf(row)).toMatchObject({
      title: 'Book a rental',
      layout: 'stepped',
      titleMode: 'template',
      titleTemplate: 'Hi {contact_name}',
      submitLabel: 'Go',
      notify: ['dana@pyresauna.com'],
      confetti: true,
      doneHref: '/admin/boards',
      doneLabel: 'Open the board',
    });
  });
});

describe('parseFormPatch', () => {
  it('refuses a value outside each vocabulary', () => {
    expect(error(parseFormPatch({ access: 'anyone' }))).toMatch(/access/);
    expect(error(parseFormPatch({ layout: 'wizard' }))).toMatch(/layout/);
    expect(error(parseFormPatch({ titleMode: 'guess' }))).toMatch(/titleMode/);
    expect(error(parseFormPatch({ enabled: 'yes' }))).toMatch(/enabled/);
  });

  it('bounds the texts and insists on a submit label', () => {
    expect(error(parseFormPatch({ intro: 'x'.repeat(2001) }))).toMatch(/intro/);
    expect(error(parseFormPatch({ title: 'x'.repeat(121) }))).toMatch(/title/);
    expect(value(parseFormPatch({ title: '  ' }))).toEqual({ title: '' });
    expect(error(parseFormPatch({ submitLabel: '   ' }))).toMatch(/submitLabel/);
    expect(value(parseFormPatch({ intro: '  hello  ', submitLabel: ' Go ' }))).toEqual({
      intro: 'hello',
      submitLabel: 'Go',
    });
  });

  it('checks every question', () => {
    expect(error(parseFormPatch({ questions: 'no' }))).toMatch(/list/);
    expect(error(parseFormPatch({ questions: [{ kind: 'builtin', key: 'owner' }] }))).toMatch(
      /builtin/
    );
    expect(error(parseFormPatch({ questions: [{ kind: 'field', key: 'Bad Key' }] }))).toMatch(
      /key/
    );
    expect(
      error(parseFormPatch({ questions: [{ kind: 'field', key: 'a_key', required: 'yes' }] }))
    ).toMatch(/required/);
    expect(
      error(
        parseFormPatch({
          questions: [
            { kind: 'field', key: 'a_key' },
            { kind: 'field', key: 'a_key' },
          ],
        })
      )
    ).toMatch(/twice/);
  });

  it('accepts a full form and defaults what is left out of a question', () => {
    const patch = value(
      parseFormPatch({
        enabled: true,
        access: 'public',
        layout: 'stepped',
        titleMode: 'template',
        titleTemplate: 'Rental for {contact_name}',
        questions: [{ kind: 'field', key: 'contact_name', label: ' Your name ', hint: '' }],
      })
    );
    expect(patch.questions).toEqual([
      { kind: 'field', key: 'contact_name', label: 'Your name', hint: null, required: false },
    ]);
    expect(patch.layout).toBe('stepped');
  });

  it('has nothing to say about an empty body', () => {
    expect(error(parseFormPatch({}))).toMatch(/Nothing/);
  });
});

describe('finalizeForm', () => {
  it('adds a required Title question when the form asks for one and has none', () => {
    const config = value(finalizeForm({ ...base, questions: base.questions.slice(1) }));
    expect(config.questions[0]).toMatchObject({ kind: 'builtin', key: 'title', required: true });
    expect(config.questions).toHaveLength(base.questions.length);
  });

  it('forces the Title question required where it sits', () => {
    const relaxed = base.questions.map((q) => (q.key === 'title' ? { ...q, required: false } : q));
    const moved = [relaxed[1], relaxed[0], ...relaxed.slice(2)];
    const config = value(finalizeForm({ ...base, questions: moved }));
    expect(config.questions[1]).toMatchObject({ key: 'title', required: true });
  });

  it('drops the Title question and needs a template when the title is built', () => {
    expect(error(finalizeForm({ ...base, titleMode: 'template', titleTemplate: ' ' }))).toMatch(
      /template/
    );
    const config = value(
      finalizeForm({ ...base, titleMode: 'template', titleTemplate: 'Lead: {contact_name}' })
    );
    expect(config.questions.some((q) => q.key === 'title')).toBe(false);
  });
});

describe('templateKeys and formFieldError', () => {
  it('lists each key once', () => {
    expect(templateKeys('{aa} and {bb} and {aa}, not {Bad}')).toEqual(['aa', 'bb']);
  });

  it('names the first thing the board does not have', () => {
    expect(formFieldError(base, fields)).toBeNull();
    expect(
      formFieldError(
        {
          ...base,
          questions: [{ kind: 'field', key: 'retired', label: null, hint: null, required: false }],
        },
        fields
      )
    ).toMatch(/retired/);
    expect(
      formFieldError({ ...base, titleMode: 'template', titleTemplate: 'Hi {nobody}' }, fields)
    ).toMatch(/nobody/);
  });
});

describe('formQuestions', () => {
  it('resolves labels, hints, and kinds against the live fields', () => {
    const questions = formQuestions(base, fields);
    expect(questions.map((q) => q.id)).toEqual([
      '$title',
      'contact_name',
      'party_size',
      'catering',
    ]);
    expect(questions[2]).toMatchObject({
      label: 'How many?',
      hint: 'Roughly',
      field: { kind: 'number' },
    });
    expect(questions[1].label).toBe('Contact name');
  });

  it('skips archived and unknown fields and repeated questions', () => {
    const questions = formQuestions(
      {
        ...base,
        questions: [
          ...base.questions,
          { kind: 'field', key: 'retired', label: null, hint: null, required: true },
          { kind: 'field', key: 'ghost', label: null, hint: null, required: true },
          { kind: 'field', key: 'contact_name', label: 'Again', hint: null, required: false },
        ],
      },
      fields
    );
    expect(questions.map((q) => q.key)).toEqual([
      'title',
      'contact_name',
      'party_size',
      'catering',
    ]);
  });

  it('hides the Title question when the title is built, and always asks it otherwise', () => {
    expect(
      formQuestions({ ...base, titleMode: 'template' }, fields).some((q) => q.key === 'title')
    ).toBe(false);
    const questions = formQuestions({ ...base, questions: base.questions.slice(1) }, fields);
    expect(questions[0]).toMatchObject({ id: '$title', required: true });
  });
});

describe('answerOf and isAnswered', () => {
  const [title, name, size, cateringQ] = formQuestions(base, fields);
  const extrasQ = formQuestions(
    {
      ...base,
      questions: [{ kind: 'field', key: 'extras', label: null, hint: null, required: true }],
    },
    fields
  )[1];
  const windowQ = formQuestions(
    {
      ...base,
      questions: [{ kind: 'field', key: 'window', label: null, hint: null, required: true }],
    },
    fields
  )[1];

  it('counts false and zero as answers', () => {
    expect(isAnswered(cateringQ, false)).toBe(true);
    expect(isAnswered(size, 0)).toBe(true);
  });

  it('does not count an empty pick-any or half a window', () => {
    expect(isAnswered(extrasQ, [])).toBe(false);
    expect(isAnswered(windowQ, ['09:00', ''])).toBe(false);
    expect(isAnswered(windowQ, ['09:00', '11:00'])).toBe(true);
  });

  it('trims builtins and checks a due date', () => {
    expect(answerOf(title, '  Party  ')).toBe('Party');
    expect(answerOf(title, '   ')).toBeNull();
    expect(answerOf(name, undefined)).toBeNull();
    const due = formQuestions(
      {
        ...base,
        questions: [{ kind: 'builtin', key: 'due_date', label: null, hint: null, required: false }],
      },
      fields
    )[1];
    expect(answerOf(due, '2026-10-03')).toBe('2026-10-03');
    expect(answerOf(due, 'soon')).toBeNull();
  });
});

describe('renderTitle', () => {
  it('fills placeholders from answers in their field shape', () => {
    expect(
      renderTitle(
        '{occasion} for {contact_name} ({party_size}), catering {catering}',
        { occasion: 'Birthday', contact_name: 'Dana', party_size: '12', catering: true },
        fields,
        'New lead'
      )
    ).toBe('Birthday for Dana (12), catering Yes');
  });

  it('blanks what it cannot fill and tidies the spaces', () => {
    expect(
      renderTitle('{nobody} {contact_name}   here', { contact_name: 'Dana' }, fields, 'x')
    ).toBe('Dana here');
  });

  it('falls back when nothing is left, and never runs long', () => {
    expect(renderTitle('{contact_name}', {}, fields, 'New lead')).toBe('New lead');
    expect(
      renderTitle('{contact_name}', { contact_name: 'a'.repeat(400) }, fields, 'x')
    ).toHaveLength(300);
  });
});

describe('parseSubmission', () => {
  const submit = (answers: unknown, config: FormConfig = base) =>
    parseSubmission(config, fields, { answers }, 'New lead');

  it('needs an object of answers', () => {
    expect(error(submit('no'))).toMatch(/answers/);
  });

  it('enforces required questions by their label', () => {
    expect(error(submit({ $title: 'Party' }))).toBe('"Contact name" is required');
    expect(error(submit({ contact_name: 'Dana' }))).toBe('"Title" is required');
  });

  it('lets an optional question go unanswered and keeps the answers it got', () => {
    const result = value(submit({ $title: ' Party ', contact_name: 'Dana', catering: false }));
    expect(result).toEqual({
      title: 'Party',
      notes_md: '',
      due_date: null,
      properties: { contact_name: 'Dana', catering: false },
    });
  });

  it('drops an answer to a question the form does not ask', () => {
    const result = value(
      submit({ $title: 'Party', contact_name: 'Dana', occasion: 'Birthday', $notes: 'hidden' })
    );
    expect(result.properties).not.toHaveProperty('occasion');
    expect(result.notes_md).toBe('');
  });

  it('builds the title from a template and never asks for one', () => {
    const config: FormConfig = {
      ...base,
      titleMode: 'template',
      titleTemplate: 'Rental for {contact_name}',
    };
    const result = value(submit({ contact_name: 'Dana', $title: 'ignored' }, config));
    expect(result.title).toBe('Rental for Dana');
  });

  it('maps the notes and due date builtins onto the card', () => {
    const config: FormConfig = {
      ...base,
      questions: [
        ...base.questions,
        { kind: 'builtin', key: 'notes', label: null, hint: null, required: false },
        { kind: 'builtin', key: 'due_date', label: null, hint: null, required: true },
      ],
    };
    expect(error(submit({ $title: 'Party', contact_name: 'Dana' }, config))).toBe(
      '"Due date" is required'
    );
    const result = value(
      submit(
        { $title: 'Party', contact_name: 'Dana', $notes: ' Bring cake ', $due_date: '2026-10-03' },
        config
      )
    );
    expect(result.notes_md).toBe('Bring cake');
    expect(result.due_date).toBe('2026-10-03');
  });
});

describe('several dates on a question', () => {
  const dateField = {
    key: 'event_date',
    label: 'Event date',
    kind: 'date',
    options: [],
    hint: null,
    archived: false,
  } as Pick<BoardFieldRow, 'key' | 'label' | 'kind' | 'options' | 'hint' | 'archived'>;
  const textField = { ...dateField, key: 'name', label: 'Name', kind: 'text' as const };

  it('keeps the flag on a field question and drops it from a builtin', () => {
    const patch = parseFormPatch({
      questions: [
        { kind: 'field', key: 'event_date', multiple: true },
        { kind: 'builtin', key: 'notes', multiple: true },
        { kind: 'field', key: 'name', multiple: false },
      ],
    });
    if (!patch.ok) throw new Error(patch.error);
    expect(patch.value.questions?.[0]).toMatchObject({ multiple: true });
    expect(patch.value.questions?.[1]).not.toHaveProperty('multiple');
    expect(patch.value.questions?.[2]).not.toHaveProperty('multiple');
  });

  it('refuses a flag that is not a boolean', () => {
    const patch = parseFormPatch({
      questions: [{ kind: 'field', key: 'event_date', multiple: 'yes' }],
    });
    expect(patch.ok).toBe(false);
  });

  it('resolves to several only for a date field that asked for it', () => {
    const resolved = formQuestions(
      {
        titleMode: 'template',
        questions: [
          {
            kind: 'field',
            key: 'event_date',
            label: null,
            hint: null,
            required: false,
            multiple: true,
          },
          { kind: 'field', key: 'name', label: null, hint: null, required: false, multiple: true },
        ],
      },
      [dateField, textField]
    );
    expect(resolved.map((question) => question.multiple)).toEqual([true, false]);
  });

  it('keeps one date on a one-date question, several on a several-dates one', () => {
    const [one] = formQuestions(
      {
        titleMode: 'template',
        questions: [{ kind: 'field', key: 'event_date', label: null, hint: null, required: true }],
      },
      [dateField]
    );
    expect(answerOf(one, ['2026-10-03', '2026-10-04'])).toBe('2026-10-03');
    expect(answerOf(one, '2026-10-03')).toBe('2026-10-03');
    expect(answerOf(one, [])).toBeNull();
    const [several] = formQuestions(
      {
        titleMode: 'template',
        questions: [
          {
            kind: 'field',
            key: 'event_date',
            label: null,
            hint: null,
            required: true,
            multiple: true,
          },
        ],
      },
      [dateField]
    );
    expect(answerOf(several, ['2026-10-03', '2026-10-04'])).toEqual(['2026-10-03', '2026-10-04']);
  });
});

describe('who a submission wakes', () => {
  const dana = { email: 'dana@pyresauna.com' };
  const sam = { email: 'sam@pyresauna.com' };

  it('takes a list of addresses, lowercased and deduplicated', () => {
    const patch = value(
      parseFormPatch({ notify: ['Dana@pyresauna.com', 'dana@pyresauna.com', ' '] })
    );
    expect(patch.notify).toEqual(['dana@pyresauna.com']);
  });

  it('refuses anything that is not a list of addresses', () => {
    expect(error(parseFormPatch({ notify: 'dana@pyresauna.com' }))).toMatch(/list/);
    expect(error(parseFormPatch({ notify: ['dana'] }))).toMatch(/not an address/);
    expect(
      error(parseFormPatch({ notify: Array.from({ length: 21 }, (_, i) => `p${i}@pyre.com`) }))
    ).toMatch(/at most 20/);
  });

  it('refuses a name that cannot open the board', () => {
    expect(formNotifyError({ notify: ['dana@pyresauna.com'] }, [dana, sam])).toBeNull();
    expect(formNotifyError({ notify: [] }, [])).toBeNull();
    expect(formNotifyError({ notify: ['nobody@pyresauna.com'] }, [dana])).toMatch(
      /cannot open this board/
    );
  });

  it('wakes everyone holding the board until the form names somebody', () => {
    const holders = ['dana@pyresauna.com', 'sam@pyresauna.com'];
    expect(notifyRecipients([], holders)).toEqual(holders);
    expect(notifyRecipients(['sam@pyresauna.com'], holders)).toEqual(['sam@pyresauna.com']);
  });

  it('drops a name that has since lost the board', () => {
    expect(notifyRecipients(['gone@pyresauna.com'], ['dana@pyresauna.com'])).toEqual([]);
  });
});

describe('confetti', () => {
  it('is a flag on the form and nothing else', () => {
    expect(value(parseFormPatch({ confetti: true })).confetti).toBe(true);
    expect(value(parseFormPatch({ confetti: false })).confetti).toBe(false);
    expect(error(parseFormPatch({ confetti: 'yes' }))).toMatch(/true or false/);
  });
});

describe('the button under the thank-you', () => {
  it('sends people home when the form has not said otherwise', () => {
    expect(formDoneLink({ doneHref: '', doneLabel: '' })).toEqual({
      href: FORM_DONE_HREF,
      label: FORM_DONE_LABEL,
    });
  });

  it('takes the link and the label the form was given', () => {
    expect(formDoneLink({ doneHref: '/admin/boards', doneLabel: 'Open the board' })).toEqual({
      href: '/admin/boards',
      label: 'Open the board',
    });
  });

  it('labels a link of its own when nobody wrote a label', () => {
    expect(formDoneLink({ doneHref: 'https://pyresauna.com/rentals', doneLabel: '' })).toEqual({
      href: 'https://pyresauna.com/rentals',
      label: 'Continue',
    });
  });

  it('falls back home rather than following something unsafe', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,hi', '//evil.example', 'nope']) {
      expect(formDoneLink({ doneHref: href, doneLabel: 'Go' }).href).toBe(FORM_DONE_HREF);
    }
  });

  it('refuses to save a link that is neither https nor a path', () => {
    expect(value(parseFormPatch({ doneHref: '/thanks' })).doneHref).toBe('/thanks');
    expect(value(parseFormPatch({ doneHref: 'https://pyresauna.com' })).doneHref).toBe(
      'https://pyresauna.com'
    );
    // Blank is allowed: it is how a form goes back to the default.
    expect(value(parseFormPatch({ doneHref: '  ' })).doneHref).toBe('');
    expect(error(parseFormPatch({ doneHref: 'javascript:alert(1)' }))).toMatch(/https/);
    expect(error(parseFormPatch({ doneHref: 'http://pyresauna.com' }))).toMatch(/https/);
  });
});

describe('an answer that does not hold', () => {
  const emailQuestion = {
    id: 'contact_email',
    kind: 'field' as const,
    key: 'contact_email',
    label: 'Email',
    hint: null,
    required: false,
    multiple: false,
    future: false,
    field: { kind: 'email' as const, options: [] },
  };
  const phoneQuestion = {
    ...emailQuestion,
    id: 'phone',
    key: 'phone',
    label: 'Phone',
    field: { kind: 'phone' as const, options: [] },
  };

  it('says so rather than dropping it, even when nobody had to answer', () => {
    expect(answerProblem(emailQuestion, 'dana@')).toMatch(/email address/);
    expect(answerProblem(phoneQuestion, '555')).toMatch(/phone number/);
  });

  it('has nothing to say about a blank optional question, or a good answer', () => {
    expect(answerProblem(emailQuestion, '')).toBeNull();
    expect(answerProblem(emailQuestion, null)).toBeNull();
    expect(answerProblem(emailQuestion, 'dana@pyresauna.com')).toBeNull();
  });

  it('asks for a required answer in the usual words', () => {
    expect(answerProblem({ ...emailQuestion, required: true }, '')).toBe('This one is needed.');
  });

  it('turns a bad address away at the door as well', () => {
    const form: FormConfig = {
      ...base,
      titleMode: 'template',
      titleTemplate: 'Rental',
      questions: [
        { kind: 'field', key: 'contact_email', label: null, hint: null, required: false },
      ],
    };
    const emailField = field({ key: 'contact_email', label: 'Email', kind: 'email' });
    const bad = parseSubmission(
      form,
      [emailField],
      { answers: { contact_email: 'dana@' } },
      'New lead'
    );
    expect(error(bad)).toMatch(/email address/);
    const good = parseSubmission(
      form,
      [emailField],
      { answers: { contact_email: ' Dana@PyreSauna.com ' } },
      'New lead'
    );
    expect(value(good).properties.contact_email).toBe('dana@pyresauna.com');
  });
});

describe('a date that has to be still to come', () => {
  const requested = field({ key: 'requested_date', label: 'Date', kind: 'date' });
  const dateQuestion = (extra: Partial<ResolvedQuestion> = {}): ResolvedQuestion => ({
    id: 'requested_date',
    kind: 'field',
    key: 'requested_date',
    label: 'Date',
    hint: null,
    required: false,
    multiple: false,
    future: true,
    field: { kind: 'date', options: [] },
    ...extra,
  });

  it('is carried on the question, and only for a date field', () => {
    const questions = value(
      parseFormPatch({
        questions: [
          { kind: 'field', key: 'requested_date', future: true },
          { kind: 'field', key: 'contact_name', future: true },
          { kind: 'builtin', key: 'notes', future: true },
        ],
      })
    ).questions;
    expect(questions?.[0]).toMatchObject({ future: true });
    // The flag is kept on any field question but only ever means something
    // on a date, which formQuestions is where it is settled.
    expect(questions?.[2].future).toBeUndefined();
    const resolved = formQuestions(
      {
        titleMode: 'template',
        questions: [
          {
            kind: 'field',
            key: 'requested_date',
            label: null,
            hint: null,
            required: false,
            future: true,
          },
          {
            kind: 'field',
            key: 'contact_name',
            label: null,
            hint: null,
            required: false,
            future: true,
          },
        ],
      },
      [requested, contactName]
    );
    expect(resolved[0].future).toBe(true);
    expect(resolved[1].future).toBe(false);
  });

  it('refuses a flag that is neither true nor false', () => {
    const bad = parseFormPatch({
      questions: [{ kind: 'field', key: 'requested_date', future: 'yes' }],
    });
    expect(error(bad)).toMatch(/future must be true or false/);
  });

  it('turns away a date that has gone, and takes today', () => {
    const question = dateQuestion();
    expect(answerProblem(question, '2026-09-21', '2026-09-22')).toBe(
      'That date has already passed.'
    );
    expect(answerProblem(question, '2026-09-22', '2026-09-22')).toBeNull();
    expect(answerProblem(question, '2026-09-23', '2026-09-22')).toBeNull();
    // Nothing at all is still nothing to say about an optional question.
    expect(answerProblem(question, null, '2026-09-22')).toBeNull();
  });

  it('turns away a list with anything gone in it', () => {
    const question = dateQuestion({ multiple: true });
    expect(answerProblem(question, ['2026-09-23', '2026-09-20'], '2026-09-22')).toMatch(
      /today or later/
    );
    expect(answerProblem(question, ['2026-09-23', '2026-09-24'], '2026-09-22')).toBeNull();
  });

  it('says nothing about a date question that was not asked to care', () => {
    expect(answerProblem(dateQuestion({ future: false }), '2020-01-01', '2026-09-22')).toBeNull();
  });

  it('closes the door on a past date at the route as well', () => {
    const form: FormConfig = {
      ...base,
      titleMode: 'template',
      titleTemplate: 'Rental',
      questions: [
        {
          kind: 'field',
          key: 'requested_date',
          label: null,
          hint: null,
          required: false,
          future: true,
        },
      ],
    };
    const gone = parseSubmission(
      form,
      [requested],
      { answers: { requested_date: '2020-01-01' } },
      'New lead'
    );
    expect(error(gone)).toMatch(/already passed/);
  });
});

describe('what the form says while it is being filled in', () => {
  it('knows a blank answer from an answered one, whatever the control sent', () => {
    expect(isBlankAnswer(null)).toBe(true);
    expect(isBlankAnswer(undefined)).toBe(true);
    expect(isBlankAnswer('   ')).toBe(true);
    expect(isBlankAnswer([])).toBe(true);
    expect(isBlankAnswer('dana@')).toBe(false);
    expect(isBlankAnswer(['2026-10-03'])).toBe(false);
    // A no is an answer, and so is zero.
    expect(isBlankAnswer(false)).toBe(false);
    expect(isBlankAnswer(0)).toBe(false);
  });

  it('says the same words the card drawer says', () => {
    const question: ResolvedQuestion = {
      id: 'contact_email',
      kind: 'field',
      key: 'contact_email',
      label: 'Email',
      hint: null,
      required: false,
      multiple: false,
      future: false,
      field: { kind: 'email', options: [] },
    };
    expect(answerProblem(question, 'dana@')).toBe(KIND_PROBLEMS.email);
  });
});
