// The access rules the knowledge assistant applies on the agent side: role
// selection from session auth, scope parsing from the dashboard's header,
// and SOP grant evaluation (a mirror of the dashboard's canViewSop). The
// SQL side of the same rules lives in knowledge_search() and is exercised
// against a local database, not here.

import { describe, expect, it } from 'vitest';
import { canViewSop, type SopRow } from '../agent/lib/knowledge/sops';
import { DEFAULT_KNOWLEDGE_SCOPE, parseKnowledgeScope, resolveRole } from '../agent/lib/role';

const principal = (attributes: Record<string, string>) => ({
  authenticator: 'channel-secret',
  principalId: 'pyre-integrations',
  principalType: 'service',
  attributes,
});

describe('resolveRole', () => {
  it('defaults to the scheduler with no auth, or no agent attribute', () => {
    expect(resolveRole(undefined).role).toBe('scheduler');
    expect(resolveRole({ initiator: principal({}), current: null }).role).toBe('scheduler');
  });

  it('runs as the knowledge assistant only when the initiator says so', () => {
    const scope = JSON.stringify({ role: 'shift_lead', email: 'Sam@PyreSauna.com', water: true });
    const resolved = resolveRole({
      initiator: principal({ agent: 'knowledge', scope }),
      current: principal({}),
    });
    expect(resolved.role).toBe('knowledge');
    expect(resolved.scope).toEqual({
      role: 'shift_lead',
      email: 'sam@pyresauna.com',
      shiftNotes: null,
      incidents: null,
      water: true,
      schedule: false,
    });
  });

  it('never lets a follow-up caller widen or flip the initiator', () => {
    const resolved = resolveRole({
      initiator: principal({}),
      current: principal({
        agent: 'knowledge',
        scope: JSON.stringify({ role: 'admin', shiftNotes: 'all' }),
      }),
    });
    expect(resolved.role).toBe('scheduler');
  });
});

describe('parseKnowledgeScope', () => {
  it('falls back to staff-only SOPs on garbage', () => {
    expect(parseKnowledgeScope('not json')).toEqual(DEFAULT_KNOWLEDGE_SCOPE);
    expect(parseKnowledgeScope(null)).toEqual(DEFAULT_KNOWLEDGE_SCOPE);
    expect(parseKnowledgeScope({ role: 'owner', shiftNotes: 'everyone', water: 'yes' })).toEqual(
      DEFAULT_KNOWLEDGE_SCOPE
    );
  });

  it('keeps only the recognised values', () => {
    expect(
      parseKnowledgeScope({
        role: 'admin',
        email: ' A@B.co ',
        shiftNotes: 'mine',
        incidents: 'all',
        water: true,
        schedule: true,
      })
    ).toEqual({
      role: 'admin',
      email: 'a@b.co',
      shiftNotes: 'mine',
      incidents: 'all',
      water: true,
      schedule: true,
    });
  });

  it('treats the schedule grant as a strict boolean', () => {
    expect(parseKnowledgeScope({ schedule: 'true' }).schedule).toBe(false);
    expect(parseKnowledgeScope({ schedule: 1 }).schedule).toBe(false);
    expect(parseKnowledgeScope({ schedule: true }).schedule).toBe(true);
  });
});

describe('canViewSop', () => {
  const sop = (overrides: Partial<SopRow>): SopRow => ({
    id: '1',
    slug: 'doc',
    title: 'Doc',
    category: 'General',
    content_md: '',
    archived: false,
    view_roles: ['staff', 'shift_lead', 'admin'],
    edit_roles: ['admin'],
    view_emails: [],
    edit_emails: [],
    sort_order: 0,
    current_version: 1,
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  });
  const staff = { ...DEFAULT_KNOWLEDGE_SCOPE, email: 'sam@pyresauna.com' };
  const lead = { ...staff, role: 'shift_lead' as const };
  const admin = { ...staff, role: 'admin' as const };

  it('follows the role grants as a set, not a ladder', () => {
    const leadsOnly = sop({ view_roles: ['shift_lead'] });
    expect(canViewSop(staff, leadsOnly)).toBe(false);
    expect(canViewSop(lead, leadsOnly)).toBe(true);
    expect(canViewSop(staff, sop({ view_roles: ['staff'] }))).toBe(true);
    expect(canViewSop(lead, sop({ view_roles: ['staff'] }))).toBe(false);
  });

  it('honours named emails and the edit-implies-view rule', () => {
    expect(canViewSop(staff, sop({ view_roles: [], view_emails: ['sam@pyresauna.com'] }))).toBe(true);
    expect(canViewSop(staff, sop({ view_roles: [], edit_emails: ['sam@pyresauna.com'] }))).toBe(true);
    expect(canViewSop(staff, sop({ view_roles: [], edit_roles: ['staff'] }))).toBe(true);
    expect(canViewSop({ ...staff, email: '' }, sop({ view_roles: [], view_emails: [''] }))).toBe(false);
  });

  it('hides archived documents from everyone but admins', () => {
    const archived = sop({ archived: true });
    expect(canViewSop(staff, archived)).toBe(false);
    expect(canViewSop(lead, archived)).toBe(false);
    expect(canViewSop(admin, archived)).toBe(true);
    expect(canViewSop(admin, sop({ view_roles: [], edit_roles: [] }))).toBe(true);
  });
});
