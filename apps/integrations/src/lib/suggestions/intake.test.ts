import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { checkAssignees } from './intake';

/** A staff table with these active emails, answering select().eq().in(). */
function rosterDb(active: string[]): SupabaseClient {
  const query = {
    select: () => query,
    eq: () => query,
    in: (_column: string, wanted: string[]) =>
      Promise.resolve({
        data: active.filter((e) => wanted.includes(e)).map((email) => ({ email })),
        error: null,
      }),
  };
  return { from: () => query } as unknown as SupabaseClient;
}

describe('checkAssignees', () => {
  const db = rosterDb(['sam@pyre.test', 'maya@pyre.test']);

  it('leaves the board default when the agent names nobody', async () => {
    expect(await checkAssignees(db, undefined)).toEqual({ ok: true, emails: [] });
  });

  it('keeps people on the active roster, lowercased and once each', async () => {
    expect(await checkAssignees(db, [' Sam@Pyre.test', 'sam@pyre.test', 'maya@pyre.test'])).toEqual(
      {
        ok: true,
        emails: ['sam@pyre.test', 'maya@pyre.test'],
      }
    );
  });

  it('refuses anyone not on the roster, naming them', async () => {
    const result = await checkAssignees(db, ['sam@pyre.test', 'owner@pyresauna.com']);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('owner@pyresauna.com');
  });

  it('refuses something that is not a list of emails', async () => {
    expect((await checkAssignees(db, 'sam@pyre.test')).ok).toBe(false);
  });
});
