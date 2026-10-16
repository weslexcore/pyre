import { describe, expect, it } from 'vitest';
import { type DutyOrderItem, moveDuty } from './duty-order';

const items: DutyOrderItem[] = [
  { key: 'setup_a', phase: 'setup' },
  { key: 'setup_b', phase: 'setup' },
  { key: 'host', phase: 'session' },
  { key: 'customer_care', phase: 'session' },
];

const keys = (list: readonly DutyOrderItem[], phase: string) =>
  list.filter((d) => d.phase === phase).map((d) => d.key);

describe('moveDuty', () => {
  it('reorders within a section, either way', () => {
    expect(keys(moveDuty(items, 'setup_b', { kind: 'duty', key: 'setup_a' }), 'setup')).toEqual([
      'setup_b',
      'setup_a',
    ]);
    expect(
      keys(moveDuty(items, 'host', { kind: 'duty', key: 'customer_care' }), 'session')
    ).toEqual(['customer_care', 'host']);
  });

  it("takes another section's duty's place, and its phase", () => {
    const next = moveDuty(items, 'host', { kind: 'duty', key: 'setup_b' });
    expect(keys(next, 'setup')).toEqual(['setup_a', 'host', 'setup_b']);
    expect(keys(next, 'session')).toEqual(['customer_care']);
  });

  it('goes last when dropped on a section, even an empty one', () => {
    expect(
      keys(moveDuty(items, 'setup_a', { kind: 'phase', phase: 'session' }), 'session')
    ).toEqual(['host', 'customer_care', 'setup_a']);
    expect(
      keys(moveDuty(items, 'host', { kind: 'phase', phase: 'off_shift' }), 'off_shift')
    ).toEqual(['host']);
  });

  it('hands back the same list when nothing moves', () => {
    expect(moveDuty(items, 'host', { kind: 'duty', key: 'host' })).toBe(items);
    expect(moveDuty(items, 'customer_care', { kind: 'phase', phase: 'session' })).toBe(items);
    expect(moveDuty(items, 'nope', { kind: 'phase', phase: 'session' })).toBe(items);
  });
});
