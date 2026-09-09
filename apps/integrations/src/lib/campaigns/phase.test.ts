import { describe, expect, it } from 'vitest';
import { campaignPhase, todayYmd } from './phase';

const today = '2026-09-09';

describe('campaignPhase', () => {
  it('is live inside the dates and when dates are open', () => {
    expect(campaignPhase({ status: 'active', startsAt: '', endsAt: '' }, today)).toBe('live');
    expect(
      campaignPhase({ status: 'active', startsAt: '2026-09-01', endsAt: '2026-09-30' }, today)
    ).toBe('live');
    expect(campaignPhase({ status: 'active', startsAt: today, endsAt: today }, today)).toBe('live');
  });

  it('is upcoming before the start and ended after the end', () => {
    expect(campaignPhase({ status: 'active', startsAt: '2026-09-10', endsAt: '' }, today)).toBe(
      'upcoming'
    );
    expect(campaignPhase({ status: 'active', startsAt: '', endsAt: '2026-09-08' }, today)).toBe(
      'ended'
    );
  });

  it('reports archived regardless of dates', () => {
    expect(
      campaignPhase({ status: 'archived', startsAt: '2026-09-01', endsAt: '2026-09-30' }, today)
    ).toBe('archived');
  });
});

describe('todayYmd', () => {
  it('formats on the New York clock', () => {
    // 03:00 UTC on the 10th is still the evening of the 9th in New York.
    expect(todayYmd(new Date('2026-09-10T03:00:00Z'))).toBe('2026-09-09');
  });
});
