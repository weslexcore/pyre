import { describe, expect, it } from 'vitest';
import { describeReason } from './reasons';

describe('describeReason', () => {
  it('puts skip and exit rules in the words the editor uses', () => {
    expect(describeReason('skip:not-attended-trigger-session')).toBe(
      'did not check in to the session'
    );
    expect(describeReason('exit:has-active-membership')).toBe('has an active membership');
    expect(describeReason('skip:has-credits')).toBe('has credits left');
  });

  it('explains why an email did not go out', () => {
    expect(describeReason('missing-merge-field:creditsExpireOn,introExpiresOn')).toBe(
      'no value for {{creditsExpireOn}}, {{introExpiresOn}}'
    );
    expect(describeReason('suppressed:template-not-live')).toMatch(/template is not live/);
    expect(describeReason('skipped:already-sent')).toMatch(/already sent/);
    expect(describeReason('frequency-cap:2026-10-14T13:00:00.000Z')).toMatch(/recently/);
  });

  it('names who did something by hand', () => {
    expect(describeReason('removed-by:wes@pyresauna.com')).toBe('removed by wes@pyresauna.com');
    expect(describeReason('manual:wes@pyresauna.com')).toBe('added by wes@pyresauna.com');
  });

  it('degrades to readable text for codes it does not know', () => {
    expect(describeReason('something-new')).toBe('something new');
    expect(describeReason(null)).toBe('');
  });
});
