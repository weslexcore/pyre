import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ResolvedQuestion } from '@/lib/boards/forms';
import { BoardForm } from './BoardForm';

const questions: ResolvedQuestion[] = [
  {
    id: '$title',
    kind: 'builtin',
    key: 'title',
    label: 'Title',
    hint: null,
    required: true,
    field: null,
  },
  {
    id: 'contact_name',
    kind: 'field',
    key: 'contact_name',
    label: 'Your name',
    hint: 'First is fine',
    required: false,
    field: { kind: 'text', options: [] },
  },
  {
    id: 'catering',
    kind: 'field',
    key: 'catering',
    label: 'Catering?',
    hint: null,
    required: true,
    field: { kind: 'yes_no', options: [] },
  },
];

function render(layout: 'single' | 'stepped', asked: ResolvedQuestion[] = questions, intro = '') {
  return renderToStaticMarkup(
    <BoardForm
      slug="rentals"
      config={{ layout, submitLabel: 'Send it', intro, confirmation: '' }}
      questions={asked}
      noun="lead"
    />
  );
}

describe('BoardForm', () => {
  it('asks every question on one page with the honeypot and the submit label', () => {
    const html = render('single');
    expect(html).toContain('Title');
    expect(html).toContain('Your name');
    expect(html).toContain('First is fine');
    expect(html).toContain('Catering?');
    expect(html).toContain('name="website"');
    expect(html).toContain('Send it');
    expect(html).not.toContain('>Next<');
  });

  it('asks one question at a time with a count and a Next button', () => {
    const html = render('stepped');
    expect(html).toContain('Title');
    expect(html).not.toContain('Your name');
    expect(html).toContain('1 of 3');
    expect(html).toContain('>Next<');
    expect(html).not.toContain('Send it');
  });

  it('renders the intro as Markdown, on the one page and on the first step only', () => {
    const intro = '## Before you book\n\nWe reply within **one day**.';
    const single = render('single', questions, intro);
    expect(single).toContain('>Before you book</h3>');
    expect(single).toMatch(/<strong[^>]*>one day<\/strong>/);
    expect(single).not.toContain('**one day**');
    expect(render('stepped', questions, intro)).toMatch(/<strong[^>]*>one day<\/strong>/);
  });

  it('offers to skip an optional question, and only an optional one', () => {
    expect(render('stepped')).not.toContain('>Skip<');
    expect(render('stepped', [questions[1], questions[2]])).toContain('>Skip<');
    expect(render('single', [questions[1]])).not.toContain('>Skip<');
  });

  it('marks required questions and leaves the yes/no label to its control', () => {
    const html = render('single');
    expect(html.match(/\(required\)/g)).toHaveLength(1);
    expect(html.match(/Catering\?/g)).toHaveLength(1);
    expect(html).toContain('>Required<');
  });
});
