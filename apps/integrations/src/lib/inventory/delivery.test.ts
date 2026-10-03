import { describe, expect, it } from 'vitest';
import { parseDelivery } from './delivery';

const ID = '00000000-0000-4000-8000-000000000001';

describe('parseDelivery', () => {
  it('takes accepted units and rejects with a reason', () => {
    expect(parseDelivery({ quantity: 43, rejected: 5, reason: ' Stained ' }, 12)).toEqual({
      accepted: 43,
      rejected: 5,
      reason: 'Stained',
      pickupIds: [],
    });
  });

  it('converts accepted lots to units', () => {
    expect(parseDelivery({ lots: 4, rejected: 0 }, 12)).toMatchObject({
      accepted: 48,
      rejected: 0,
      reason: null,
    });
  });

  it('allows a delivery that was all rejects', () => {
    expect(parseDelivery({ quantity: 0, rejected: 12, reason: 'Wet' }, 12)).toMatchObject({
      accepted: 0,
      rejected: 12,
    });
  });

  it('carries the held rejects picked up with it', () => {
    expect(parseDelivery({ quantity: 10, pickupIds: [ID] }, 1)).toMatchObject({ pickupIds: [ID] });
  });

  it('refuses rejects without a reason, empty deliveries, and bad ids', async () => {
    for (const body of [
      { quantity: 10, rejected: 2 },
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
