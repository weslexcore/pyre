import { describe, expect, it } from 'vitest';
import { relativizeDashboardLinks, turnFromHistory } from './SopAsk';

describe('turnFromHistory', () => {
  const base = {
    id: 'row-1',
    question: 'When was the left tub last shocked?',
    answer: null,
    status: 'answered' as const,
    error: null,
    askedAt: '2026-09-02T12:00:00Z',
  };

  it('shows an answered question as a finished turn', () => {
    const turn = turnFromHistory({
      ...base,
      answer: 'Yesterday, per the [water log](/admin/water).',
    });
    expect(turn).toMatchObject({
      id: 'row-1',
      question: base.question,
      answer: 'Yesterday, per the [water log](/admin/water).',
      status: 'done',
      live: '',
      activity: null,
    });
    expect(turn.error).toBeUndefined();
  });

  it('carries a failed turn as an error with its detail', () => {
    const turn = turnFromHistory({ ...base, status: 'failed', error: 'tool_error: timeout' });
    expect(turn.status).toBe('error');
    expect(turn.error).toBe('tool_error: timeout');
  });

  it('gives a failed turn without detail a generic error', () => {
    expect(turnFromHistory({ ...base, status: 'failed' }).error).toBe('The assistant hit an error');
  });

  it('keeps a failed turn that still got an answer as answered', () => {
    const turn = turnFromHistory({
      ...base,
      status: 'failed',
      answer: 'Partial answer',
      error: 'x',
    });
    expect(turn.status).toBe('done');
    expect(turn.error).toBeUndefined();
  });

  it.each(['pending', 'cancelled'] as const)('marks an unanswered %s turn as empty', (status) => {
    expect(turnFromHistory({ ...base, status }).status).toBe('empty');
  });

  it('labels a row whose question was never recorded', () => {
    expect(turnFromHistory({ ...base, question: '' }).question).toBe('(question not recorded)');
  });
});

describe('relativizeDashboardLinks', () => {
  it('makes absolute dashboard links relative so the peek modal recognises them', () => {
    expect(
      relativizeDashboardLinks('See [closing](https://staff.pyresauna.com/admin/sops/closing).')
    ).toBe('See [closing](/admin/sops/closing).');
  });

  it('leaves other links alone', () => {
    expect(relativizeDashboardLinks('[site](https://pyresauna.com/about)')).toBe(
      '[site](https://pyresauna.com/about)'
    );
  });
});
