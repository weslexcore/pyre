import { render } from '@react-email/components';
import { describe, expect, it } from 'vitest';
import { EMAIL_TEMPLATES } from '../registry';
import type { ScheduleLintProps } from '../types';
import { ScheduleLint } from './ScheduleLint';

// The email is the whole product: it has to say which rows to cancel, which
// to review, what to fix, and point every one at Momence.

const base: ScheduleLintProps = ScheduleLint.PreviewProps;

const renderText = async (props: Partial<ScheduleLintProps> = {}): Promise<string> =>
  (await render(<ScheduleLint {...base} {...props} />, { plainText: true }))
    .replace(/\s+/g, ' ')
    .trim();

const renderHtml = async (props: Partial<ScheduleLintProps> = {}): Promise<string> =>
  render(<ScheduleLint {...base} {...props} />);

describe('ScheduleLint', () => {
  it('names every special event and marks its rows cancel or review', async () => {
    const body = await renderText();
    expect(body).toContain('Sound Bath with Anna');
    expect(body).toContain('DJ Night with Lou');
    expect(body.match(/cancel Open Hours/g)).toHaveLength(3);
    expect(body.match(/cancel Social Evening/g)).toHaveLength(2);
    expect(body).toContain('review Guided Heat');
  });

  it('lists the fixes and notices in their own sections', async () => {
    const body = await renderText();
    expect(body).toMatch(/Fix .*Community Night.*No session tag/);
    expect(body).toMatch(/Still a draft and starts Sat, Sep 19/);
    expect(body).toMatch(/Notices .*Capacity 4/);
    expect(body).toContain('published through Sun, Sep 27 only');
  });

  it('links each session to Momence and never carries an action of its own', async () => {
    const html = await renderHtml();
    expect(html).toContain('href="https://momence.com/s/13"');
    expect(html).toContain('href="https://momence.com/s/40"');
    expect(html).toContain('href="https://momence.com/s/51"');
    expect(html).not.toMatch(/api\/|admin\//);
  });

  it('drops a section it has nothing for', async () => {
    const body = await renderText({
      cancelCount: 0,
      noticeCount: 0,
      overlaps: [],
      notices: [],
      fixCount: 2,
    });
    expect(body).not.toContain('Special events on top');
    expect(body).not.toContain('Notices');
    expect(body).toContain('Checked through Oct 12: 2 to fix.');
  });

  it('builds the subject from the non-zero counts', () => {
    const { subject } = EMAIL_TEMPLATES['schedule-lint'];
    expect(subject(base)).toBe('Schedule check: 5 to cancel, 2 to fix, 3 notices');
    expect(subject({ ...base, cancelCount: 0, fixCount: 0, noticeCount: 1 })).toBe(
      'Schedule check: 1 notice'
    );
    expect(subject({ ...base, cancelCount: 1, fixCount: 0, noticeCount: 0 })).toBe(
      'Schedule check: 1 to cancel'
    );
  });
});
