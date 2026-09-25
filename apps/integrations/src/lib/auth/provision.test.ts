import { beforeEach, describe, expect, it, vi } from 'vitest';

// The admin client and access lookup are faked; each test sets the roster.
const { createUser, updateUserById, rpc, update, getAccess, listStaff } = vi.hoisted(() => ({
  createUser: vi.fn(),
  updateUserById: vi.fn(),
  rpc: vi.fn(),
  update: vi.fn(),
  getAccess: vi.fn(),
  listStaff: vi.fn(),
}));

vi.mock('../db', () => ({
  getDb: () => ({
    auth: { admin: { createUser, updateUserById } },
    rpc,
    from: () => ({ update: (fields: unknown) => ({ eq: () => update(fields) }) }),
  }),
}));
vi.mock('./access', () => ({ getAccess, listStaff, invalidateAccessCache: vi.fn() }));
vi.mock('../email/send', () => ({ sendTemplate: vi.fn() }));

import { createAccountWithPassword, passwordProblem, syncAuthBan } from './provision';

const ROW = {
  id: 'staff-1',
  email: 'staff@pyresauna.com',
  display_name: 'Sam Lee',
  is_admin: false,
  active: true,
  pages: [] as string[],
  auth_user_id: null as string | null,
};

const ARGS = {
  email: 'Staff@PyreSauna.com',
  password: 'correct horse battery',
  firstName: 'Sam',
  lastName: 'Lee',
};

beforeEach(() => {
  for (const fn of [createUser, updateUserById, rpc, update, getAccess, listStaff]) fn.mockReset();
  update.mockResolvedValue({ error: null });
  updateUserById.mockResolvedValue({ error: null });
});

describe('passwordProblem', () => {
  it('checks length and match', () => {
    expect(passwordProblem('short', 'short')).toBe('too_short');
    expect(passwordProblem('x'.repeat(73), 'x'.repeat(73))).toBe('too_long');
    // 24 three-byte characters = 72 bytes: the limit is bytes, not characters.
    expect(passwordProblem('€'.repeat(25), '€'.repeat(25))).toBe('too_long');
    expect(passwordProblem('long enough 1', 'long enough 2')).toBe('mismatch');
    expect(passwordProblem('long enough 1', 'long enough 1')).toBeNull();
  });
});

describe('createAccountWithPassword', () => {
  it('refuses people without dashboard access', async () => {
    getAccess.mockResolvedValue(null);
    expect(await createAccountWithPassword(ARGS)).toEqual({ status: 'no-access' });
    expect(createUser).not.toHaveBeenCalled();
  });

  it('refuses a row that already has a password', async () => {
    getAccess.mockResolvedValue({ isAdmin: false, pages: [], source: 'db' });
    listStaff.mockResolvedValue([{ ...ROW, auth_user_id: 'existing' }]);
    expect(await createAccountWithPassword(ARGS)).toEqual({ status: 'already-linked' });
    expect(createUser).not.toHaveBeenCalled();
  });

  it('creates a confirmed user and links the row', async () => {
    getAccess.mockResolvedValue({ isAdmin: false, pages: [], source: 'db' });
    listStaff.mockResolvedValue([ROW]);
    rpc.mockResolvedValue({ data: null, error: null });
    createUser.mockResolvedValue({ data: { user: { id: 'new-user' } }, error: null });

    expect(await createAccountWithPassword(ARGS)).toEqual({ status: 'created', userId: 'new-user' });
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'staff@pyresauna.com', email_confirm: true })
    );
    expect(update).toHaveBeenCalledWith({ auth_user_id: 'new-user' });
  });

  it('adopts the auth user a pending invite created', async () => {
    getAccess.mockResolvedValue({ isAdmin: true, pages: [], source: 'db' });
    listStaff.mockResolvedValue([ROW]);
    rpc.mockResolvedValue({ data: 'invited-user', error: null });

    expect(await createAccountWithPassword(ARGS)).toEqual({
      status: 'created',
      userId: 'invited-user',
    });
    expect(createUser).not.toHaveBeenCalled();
    expect(updateUserById).toHaveBeenCalledWith(
      'invited-user',
      expect.objectContaining({ password: ARGS.password, ban_duration: 'none' })
    );
    expect(update).toHaveBeenCalledWith({ auth_user_id: 'invited-user' });
  });
});

describe('syncAuthBan', () => {
  it('does nothing for an unlinked row', async () => {
    await syncAuthBan(ROW);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('bans a linked person with no access left, and unbans on return', async () => {
    const linked = { ...ROW, auth_user_id: 'u1' };
    await syncAuthBan({ ...linked, active: false });
    expect(updateUserById).toHaveBeenLastCalledWith('u1', { ban_duration: '876000h' });
    await syncAuthBan(linked);
    expect(updateUserById).toHaveBeenLastCalledWith('u1', { ban_duration: 'none' });
    await syncAuthBan(linked, { deleted: true });
    expect(updateUserById).toHaveBeenLastCalledWith('u1', { ban_duration: '876000h' });
  });
});
