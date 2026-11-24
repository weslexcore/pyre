import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookupSuppression = vi.fn();
const create = vi.fn();
const update = vi.fn();

vi.mock('./suppression', () => ({
  lookupSuppression: (email: string) => lookupSuppression(email),
}));
vi.mock('./resend', () => ({
  getResend: () => ({ contacts: { create, update } }),
}));

const { upsertResendContact } = await import('./audience');

beforeEach(() => {
  lookupSuppression.mockReset();
  create.mockReset().mockResolvedValue({ data: { id: 'new' }, error: null });
  update.mockReset().mockResolvedValue({ data: { id: 'old' }, error: null });
});

describe('upsertResendContact', () => {
  it('creates a contact that is not suppressed without touching its flag', async () => {
    lookupSuppression.mockResolvedValue(false);
    await upsertResendContact({ email: 'a@example.com', firstName: 'A' });
    expect(create.mock.calls[0][0]).not.toHaveProperty('unsubscribed');
  });

  it('creates a suppressed contact unsubscribed, so broadcasts skip it', async () => {
    lookupSuppression.mockResolvedValue(true);
    await upsertResendContact({ email: 'gone@example.com' });
    expect(create.mock.calls[0][0]).toMatchObject({ unsubscribed: true });
  });

  it('marks an existing suppressed contact unsubscribed on update', async () => {
    lookupSuppression.mockResolvedValue(true);
    create.mockResolvedValue({ data: null, error: { message: 'exists' } });
    const result = await upsertResendContact({ email: 'gone@example.com' });
    expect(update.mock.calls[0][0]).toMatchObject({ unsubscribed: true });
    expect(result.status).toBe('updated');
  });

  it('never resubscribes an existing contact', async () => {
    lookupSuppression.mockResolvedValue(false);
    create.mockResolvedValue({ data: null, error: { message: 'exists' } });
    await upsertResendContact({ email: 'a@example.com' });
    expect(update.mock.calls[0][0]).not.toHaveProperty('unsubscribed');
  });

  it('writes nothing when the suppression list cannot be read', async () => {
    lookupSuppression.mockResolvedValue(null);
    const result = await upsertResendContact({ email: 'a@example.com' });
    expect(result).toEqual({ status: 'skipped', reason: 'suppression-unknown' });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
