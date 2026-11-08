import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureAuthUser, linkStaffUser, removeAuthUser, syncAuthUser } from './users';

const createUser = vi.fn();
const updateUserById = vi.fn();
const deleteUser = vi.fn();
const listUsers = vi.fn();
const update = vi.fn();

function db() {
  return {
    auth: { admin: { createUser, updateUserById, deleteUser, listUsers } },
    from: () => ({
      update: (fields: unknown) => {
        update(fields);
        return {
          eq: () => ({ is: async () => ({ error: null }) }),
        };
      },
    }),
  } as never;
}

describe('ensureAuthUser', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('creates a confirmed user carrying the display name', async () => {
    createUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    const result = await ensureAuthUser(db(), { email: ' Ada@Example.test ', displayName: 'Ada' });
    expect(result).toEqual({ ok: true, userId: 'u1', created: true });
    expect(createUser).toHaveBeenCalledWith({
      email: 'ada@example.test',
      email_confirm: true,
      user_metadata: { display_name: 'Ada' },
    });
  });

  it('returns the existing user when the email is taken, syncing the name', async () => {
    createUser.mockResolvedValue({
      data: { user: null },
      error: {
        code: 'email_exists',
        message: 'A user with this email address has already been registered',
      },
    });
    listUsers.mockResolvedValue({
      data: {
        users: [{ id: 'u9', email: 'ada@example.test', user_metadata: { display_name: 'A.' } }],
      },
      error: null,
    });
    updateUserById.mockResolvedValue({ error: null });
    const result = await ensureAuthUser(db(), { email: 'ada@example.test', displayName: 'Ada' });
    expect(result).toEqual({ ok: true, userId: 'u9', created: false });
    expect(updateUserById).toHaveBeenCalledWith('u9', {
      user_metadata: { display_name: 'Ada' },
    });
  });

  it('reports other failures without throwing', async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: { message: 'boom' } });
    expect(await ensureAuthUser(db(), { email: 'x@example.test', displayName: null })).toEqual({
      ok: false,
      error: 'boom',
    });
    expect(await ensureAuthUser(db(), { email: '', displayName: null })).toEqual({
      ok: false,
      error: 'No email',
    });
  });
});

describe('syncAuthUser / removeAuthUser / linkStaffUser', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('writes a changed email as confirmed and a name into metadata', async () => {
    updateUserById.mockResolvedValue({ error: null });
    await syncAuthUser(db(), 'u1', { email: 'New@Example.test', displayName: 'New Name' });
    expect(updateUserById).toHaveBeenCalledWith('u1', {
      email: 'new@example.test',
      email_confirm: true,
      user_metadata: { display_name: 'New Name' },
    });
  });

  it('is a no-op with nothing to change', async () => {
    expect(await syncAuthUser(db(), 'u1', {})).toEqual({ ok: true });
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('deletes the auth user and surfaces errors as results', async () => {
    deleteUser.mockResolvedValue({ error: null });
    expect(await removeAuthUser(db(), 'u1')).toEqual({ ok: true });
    deleteUser.mockResolvedValue({ error: { message: 'nope' } });
    expect(await removeAuthUser(db(), 'u1')).toEqual({ ok: false, error: 'nope' });
  });

  it('links the unlinked staff row with the signed-in email', async () => {
    await linkStaffUser(db(), 'u1', 'Ada@Example.test');
    expect(update).toHaveBeenCalledWith({ user_id: 'u1' });
    update.mockClear();
    await linkStaffUser(db(), 'u1', '');
    expect(update).not.toHaveBeenCalled();
  });
});
