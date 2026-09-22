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

  it('opens one question at a time on a cover, with no question until Next', () => {
    const html = render('stepped');
    expect(html).not.toContain('for="form-title"');
    expect(html).not.toContain('Your name');
    expect(html).toContain('3 questions, one at a time.');
    expect(html).toContain('>Next<');
    expect(html).not.toContain('1 of 3');
    expect(html).not.toContain('>Back<');
    expect(html).not.toContain('Send it');
  });

  it('renders the intro as Markdown, on the one page and on the cover', () => {
    const intro = '## Before you book\n\nWe reply within **one day**.';
    const single = render('single', questions, intro);
    expect(single).toContain('>Before you book</h3>');
    expect(single).toMatch(/<strong[^>]*>one day<\/strong>/);
    expect(single).not.toContain('**one day**');
    expect(render('stepped', questions, intro)).toMatch(/<strong[^>]*>one day<\/strong>/);
  });

  it('never offers to skip on the cover or on the one page', () => {
    expect(render('stepped')).not.toContain('>Skip<');
    expect(render('stepped', [questions[1], questions[2]])).not.toContain('>Skip<');
    expect(render('single', [questions[1]])).not.toContain('>Skip<');
  });

  it('asks for files with a picker and no way to read one back', () => {
    const files: ResolvedQuestion = {
      id: 'contract',
      kind: 'field',
      key: 'contract',
      label: 'Signed contract',
      hint: null,
      required: true,
      field: { kind: 'files', options: [] },
    };
    const html = render('single', [files]);
    expect(html).toContain('Signed contract');
    expect(html).toContain('type="file"');
    expect(html).toContain('multiple');
    expect(html).toContain('Up to 10 files');
    expect(html).not.toContain('/api/admin/board-media');
  });

  it('marks required questions and leaves the yes/no label to its control', () => {
    const html = render('single');
    expect(html.match(/\(required\)/g)).toHaveLength(1);
    expect(html.match(/Catering\?/g)).toHaveLength(1);
    expect(html).toContain('>Required<');
  });
});
