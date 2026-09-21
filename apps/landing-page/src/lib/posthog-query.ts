// Server-side PostHog HogQL query client for admin analytics endpoints.
// Requires a personal API key with the Query Read scope (the public phc_
// project token cannot run queries) plus the numeric project id.

const DEFAULT_HOST = 'https://us.posthog.com';

// import.meta.env is inlined by Astro at build time, so a key that is missing at
// build time compiles to undefined and falls through to process.env. That fallback
// only helps locally (e.g. `vercel dev`, tests): on Vercel the runtime env is also
// snapshotted per deployment, so a variable added or edited in the dashboard
// after the last build is invisible until the project is redeployed.
function getApiKey(): string | undefined {
  return import.meta.env.POSTHOG_PERSONAL_API_KEY ?? process.env.POSTHOG_PERSONAL_API_KEY;
}

function getProjectId(): string | undefined {
  return import.meta.env.POSTHOG_PROJECT_ID ?? process.env.POSTHOG_PROJECT_ID;
}

export function isPostHogQueryConfigured(): boolean {
  return Boolean(getApiKey() && getProjectId());
}

/** Run a HogQL query and return raw result rows. Throws if unconfigured or on API errors. */
export async function queryHogQL(query: string): Promise<unknown[][]> {
  const apiKey = getApiKey();
  const projectId = getProjectId();
  if (!apiKey || !projectId) {
    throw new Error('PostHog query API not configured');
  }

  const host = import.meta.env.POSTHOG_HOST || process.env.POSTHOG_HOST || DEFAULT_HOST;
  const res = await fetch(`${host}/api/projects/${projectId}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PostHog query failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as { results?: unknown[][] };
  return json.results ?? [];
}
