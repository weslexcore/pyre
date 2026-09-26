// Step 3a sample call: CompanyInfo from the QBO Accounting API
// (GET /v3/company/{realmId}/companyinfo/{realmId}).

import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';
import { json } from '@/lib/http/route';
import { getCompanyInfo, toErrorResponse } from '@/lib/quickbooks/client';

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  try {
    const companyInfo = await getCompanyInfo();
    return json(companyInfo);
  } catch (error) {
    return toErrorResponse(error);
  }
};
