// Enabled partners for the campaign destination picker: a partner page lives
// at /<slug> on the landing site (bft.astro is /bft), so a "Partner page"
// destination is chosen by partner. Gated on the campaigns grant rather than
// the partners one — the picker only needs names and slugs.

import type { APIRoute } from 'astro';
import { requirePage } from '@/lib/auth/admin';
import type { PartnerRef } from '@/lib/campaigns/types';
import { listPartners } from '@/lib/partner/registry';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requirePage(cookies, '/admin/campaigns');
  if (gate instanceof Response) return gate;

  const rows = (await listPartners()) ?? [];
  const partners: PartnerRef[] = rows
    .filter((p) => p.enabled)
    .map((p) => ({ slug: p.slug, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return new Response(JSON.stringify({ partners }), { status: 200, headers: JSON_HEADERS });
};
