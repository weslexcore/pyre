import { describe, expect, it } from 'vitest';
import { parseDelivery } from './delivery';

const ID = '00000000-0000-4000-8000-000000000001';

describe('parseDelivery', () => {
  it('takes accepted units and rejects with their reasons', () => {
    expect(
      parseDelivery({ quantity: 43, rejected: 5, reasons: [' Stained ', 'Torn'] }, 12)
    ).toEqual({
      accepted: 43,
      rejected: 5,
      reasons: ['Stained', 'Torn'],
      pickupIds: [],
    });
  });

  it('drops blank and repeated reasons', () => {
    expect(
      parseDelivery({ quantity: 1, rejected: 1, reasons: ['Wet', ' ', 'wet', 'Torn'] }, 1)
    ).toMatchObject({ reasons: ['Wet', 'Torn'] });
  });

  it('converts accepted lots to units', () => {
    expect(parseDelivery({ lots: 4, rejected: 0 }, 12)).toMatchObject({
      accepted: 48,
      rejected: 0,
      reasons: [],
    });
  });

  it('allows a delivery that was all rejects', () => {
    expect(parseDelivery({ quantity: 0, rejected: 12, reasons: ['Wet'] }, 12)).toMatchObject({
      accepted: 0,
      rejected: 12,
    });
  });

  it('carries the held rejects picked up with it', () => {
    expect(parseDelivery({ quantity: 10, pickupIds: [ID] }, 1)).toMatchObject({ pickupIds: [ID] });
  });

  it('refuses rejects without a reason, bad reasons, empty deliveries, and bad ids', async () => {
    for (const body of [
      { quantity: 10, rejected: 2 },
      { quantity: 10, rejected: 2, reasons: ['  '] },
      { quantity: 10, rejected: 2, reasons: 'Stained' },
      { quantity: 10, rejected: 2, reasons: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] },
      { quantity: 0, rejected: 0 },
      { quantity: 10, pickupIds: ['nope'] },
      { quantity: -3 },
    ]) {
      const result = parseDelivery(body, 1);
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(400);
    }
  });
});
