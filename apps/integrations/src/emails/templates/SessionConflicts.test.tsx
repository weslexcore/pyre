import { render } from '@react-email/components';
import { describe, expect, it } from 'vitest';
import { EMAIL_TEMPLATES } from '../registry';
import type { SessionConflictsProps } from '../types';
import { SessionConflicts } from './SessionConflicts';

// The email is the admin's Monday briefing; the page is where they act. These
// check the briefing says what the detector meant: which rows are "cancel",
// which are only "review", and that the button goes to the page.

const base: SessionConflictsProps = SessionConflicts.PreviewProps;

const renderText = async (props: Partial<SessionConflictsProps> = {}): Promise<string> =>
  (await render(<SessionConflicts {...base} {...props} />, { plainText: true }))
    .replace(/\s+/g, ' ')
    .trim();

describe('SessionConflicts', () => {
  it('names every special event and marks the preselected rows cancel', async () => {
    const body = await renderText();
    expect(body).toContain('Sound Bath with Anna');
    expect(body).toContain('DJ Night with Lou');
    expect(body.match(/cancel Open Hours/g)).toHaveLength(3);
    expect(body.match(/cancel Social Evening/g)).toHaveLength(2);
    expect(body).toContain('review Guided Heat');
    expect(body).toContain('Review and cancel in Momence');
  });

  it('counts the review-only rows in the intro', async () => {
    expect(await renderText()).toContain('1 other marked review');
    expect(await renderText({ sessionCount: 5, preselectedCount: 5 })).not.toContain(
      'marked review'
    );
  });

  it('only mentions the manual fallback once the API is known not to cancel', async () => {
    expect(await renderText()).not.toContain('not available on this account');
    expect(await renderText({ cancelSupported: false })).toContain('not available on this account');
  });

  it('pluralises the subject from the counts', () => {
    const { subject } = EMAIL_TEMPLATES['session-conflicts'];
    expect(subject({ ...base, sessionCount: 1, eventCount: 1 })).toBe(
      '1 session overlaps a special event through Oct 12'
    );
    expect(subject(base)).toBe('6 sessions overlap special events through Oct 12');
  });
});
