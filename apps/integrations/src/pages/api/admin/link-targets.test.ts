// The link picker in every markdown field lists what this route returns, so
// its filtering is the whole point: pages only when the caller holds them,
// SOPs only when they hold the SOPs page and may read that document, and
// nothing archived.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireStaff = vi.fn();
const getDb = vi.fn();
const getSopRole = vi.fn();

vi.mock('@/lib/auth/admin', () => ({ requireStaff: (c: unknown) => requireStaff(c) }));
vi.mock('@/lib/db', () => ({ getDb: () => getDb() }));
vi.mock('@/lib/sops/role', () => ({ getSopRole: (e: unknown, a: unknown) => getSopRole(e, a) }));

const { GET } = await import('./link-targets');

const sop = (slug: string, over: Record<string, unknown> = {}) => ({
  slug,
  title: slug,
  category: 'Ops',
  sort_order: 0,
  view_roles: ['staff', 'shift_lead', 'admin'],
  edit_roles: ['admin'],
  view_emails: [],
  edit_emails: [],
  archived: false,
  ...over,
});

function fakeDb(sops: Record<string, unknown>[]) {
  return {
    from: (table: string) => ({
      select: async () => ({ data: table === 'sops' ? sops : [], error: null }),
    }),
  };
}

async function hrefs(): Promise<string[]> {
  const res = await GET({ cookies: {} } as never);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { targets: { href: string }[] };
  return body.targets.map((t) => t.href);
}

describe('GET /api/admin/link-targets', () => {
  beforeEach(() => {
    getDb.mockReturnValue(
      fakeDb([
        sop('open'),
        sop('leads-only', { view_roles: ['shift_lead', 'admin'] }),
        sop('named', { view_roles: ['admin'], view_emails: ['sam@pyre.test'] }),
        sop('old', { archived: true }),
      ])
    );
  });

  it('lists only the pages and SOPs a staff member may open', async () => {
    requireStaff.mockResolvedValue({
      user: { email: 'sam@pyre.test' },
      access: { isAdmin: false, pages: ['/admin/sops', '/admin/water'] },
    });
    getSopRole.mockResolvedValue('staff');

    const list = await hrefs();
    expect(list).toContain('/admin/sops/open');
    expect(list).toContain('/admin/sops/named');
    expect(list).not.toContain('/admin/sops/leads-only');
    expect(list).not.toContain('/admin/sops/old');
    expect(list).toContain('/admin/water');
    expect(list).toContain('/admin/sops/runs');
    expect(list).not.toContain('/admin/users');
    expect(list).not.toContain('/admin/business');
    expect(list).not.toContain('/admin/campaigns');
  });

  it('offers no SOPs without the SOPs page grant', async () => {
    requireStaff.mockResolvedValue({
      user: { email: 'sam@pyre.test' },
      access: { isAdmin: false, pages: ['/admin/water'] },
    });
    getSopRole.mockResolvedValue('staff');

    const list = await hrefs();
    expect(list.some((href) => href.startsWith('/admin/sops'))).toBe(false);
    expect(list).toContain('/admin/water');
  });

  it('gives admins every page and every live SOP, still no archived ones', async () => {
    requireStaff.mockResolvedValue({
      user: { email: 'boss@pyre.test' },
      access: { isAdmin: true, pages: [] },
    });
    getSopRole.mockResolvedValue('admin');

    const list = await hrefs();
    expect(list).toContain('/admin/sops/leads-only');
    expect(list).not.toContain('/admin/sops/old');
    expect(list).toContain('/admin/users');
    expect(list).toContain('/admin/business');
  });
});
