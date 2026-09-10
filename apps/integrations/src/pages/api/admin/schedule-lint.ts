// The schedule lint's rules, behind /admin/schedule-lint.
//
// GET  — every rule as configured (built-ins with defaults filled in, then
//        custom rules), the kinds an admin can add, and the session types the
//        settings forms offer.
// POST — one of five actions, same-origin, JSON-only:
//        { action: 'create', kind, label, params }        add a custom rule
//        { action: 'update', id, label?, enabled?, params? }
//                                                        tune or toggle any rule
//        { action: 'delete', id }                         remove a custom rule
//        { action: 'preview' }                            run the saved rules
//                                                        against Momence now
//        { action: 'send' }                               run for real and email
//                                                        the admins
//
// Reads and writes need the page (admins have it; it can be granted). Every
// write is validated by lib/schedule-lint/registry.ts, so a row can never be
// saved in a shape the lint cannot run.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { fetchMomenceEvents, SESSION_TYPES } from '@/lib/momence-events';
import { runScheduleLint } from '@/lib/schedule-lint/job';
import { countFindings, runLint } from '@/lib/schedule-lint/lint';
import {
  normalizeLabel,
  normalizeParams,
  resolveRules,
  summarizeParams,
} from '@/lib/schedule-lint/registry';
import {
  BUILT_IN_DEFINITIONS,
  CUSTOM_DEFINITIONS,
  definitionFor,
  isRuleKind,
} from '@/lib/schedule-lint/rules';
import { deleteRuleRow, findRuleRow, listRuleRows, saveRuleRow } from '@/lib/schedule-lint/store';
import { HORIZON_DAYS, SCHEDULE_LINT_PAGE } from '@/lib/schedule-lint/types';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** The page's own budget for a real run: leave headroom under the function's 60s. */
const TIME_BUDGET_MS = 50_000;

/** A rule kind as the page's "add a rule" chooser and settings forms need it. */
const describeKind = (kind: string) => {
  const def = definitionFor(kind);
  if (!def) return null;
  return {
    kind: def.kind,
    title: def.title,
    description: def.description,
    builtIn: def.builtIn,
    fields: def.fields,
    defaults: def.defaults,
  };
};

async function loadState(db: NonNullable<ReturnType<typeof getDb>>) {
  const rows = await listRuleRows(db);
  const rules = resolveRules(rows).map((rule) => {
    const def = definitionFor(rule.kind);
    return { ...rule, summary: def ? summarizeParams(def, rule.params) : '' };
  });
  return {
    rules,
    kinds: [...BUILT_IN_DEFINITIONS, ...CUSTOM_DEFINITIONS]
      .map((d) => describeKind(d.kind))
      .filter(Boolean),
    sessionTypes: SESSION_TYPES,
    horizonDays: HORIZON_DAYS,
  };
}

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requirePage(cookies, SCHEDULE_LINT_PAGE);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  try {
    return json(await loadState(db));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Read failed' }, 500);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, SCHEDULE_LINT_PAGE);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Body must be JSON' }, 400);
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const actor = (gate.user.email ?? 'admin').trim().toLowerCase();

  try {
    switch (body.action) {
      case 'create': {
        if (!isRuleKind(body.kind)) return json({ error: 'Unknown rule kind' }, 400);
        const def = definitionFor(body.kind);
        if (!def || def.builtIn) {
          return json({ error: 'Built-in rules cannot be added; tune the existing one' }, 400);
        }
        const params = normalizeParams(def, body.params ?? def.defaults);
        if (!params.ok) return json({ error: params.error }, 400);
        const row = await saveRuleRow(db, {
          id: crypto.randomUUID(),
          kind: def.kind,
          label: normalizeLabel(body.label, def.title),
          enabled: body.enabled !== false,
          params: params.params,
          actor,
        });
        console.info(`[schedule-lint] ${actor} added rule ${row.id} (${def.kind}: ${row.label})`);
        return json({ ok: true, id: row.id, ...(await loadState(db)) });
      }

      case 'update': {
        const id = typeof body.id === 'string' ? body.id : '';
        if (!id) return json({ error: 'id is required' }, 400);

        // A built-in's row may not exist yet; its kind is its id.
        const existing = await findRuleRow(db, id);
        const kind = existing?.kind ?? id;
        const def = definitionFor(kind);
        if (!def || (!existing && !def.builtIn)) return json({ error: 'Rule not found' }, 404);

        const current = existing
          ? normalizeParams(def, existing.params)
          : { ok: true as const, params: { ...def.defaults } };
        const params =
          body.params !== undefined
            ? normalizeParams(def, body.params)
            : current.ok
              ? current
              : { ok: true as const, params: { ...def.defaults } };
        if (!params.ok) return json({ error: params.error }, 400);

        const row = await saveRuleRow(db, {
          id,
          kind: def.kind,
          label:
            body.label !== undefined
              ? normalizeLabel(body.label, def.title)
              : (existing?.label ?? def.title),
          enabled: typeof body.enabled === 'boolean' ? body.enabled : (existing?.enabled ?? true),
          params: params.params,
          actor,
        });
        console.info(`[schedule-lint] ${actor} updated rule ${row.id} (${row.kind})`);
        return json({ ok: true, ...(await loadState(db)) });
      }

      case 'delete': {
        const id = typeof body.id === 'string' ? body.id : '';
        if (!id) return json({ error: 'id is required' }, 400);
        const existing = await findRuleRow(db, id);
        if (!existing) return json({ error: 'Rule not found' }, 404);
        if (definitionFor(existing.kind)?.builtIn) {
          return json({ error: 'Built-in rules cannot be deleted; disable it instead' }, 400);
        }
        await deleteRuleRow(db, id);
        console.info(`[schedule-lint] ${actor} deleted rule ${id} (${existing.kind})`);
        return json({ ok: true, ...(await loadState(db)) });
      }

      case 'preview': {
        // What the saved rules find right now, disabled ones included so an
        // admin can see what switching one on would send.
        const rules = resolveRules(await listRuleRows(db)).map((r) => ({ ...r, enabled: true }));
        const events = await fetchMomenceEvents();
        const report = runLint(events, { now: new Date() }, rules);
        return json({
          ok: true,
          report: {
            horizonStart: report.horizonStart,
            horizonEnd: report.horizonEnd,
            digest: report.digest,
            findings: report.findings,
            ...countFindings(report.findings),
          },
          disabled: rules.length
            ? resolveRules(await listRuleRows(db))
                .filter((r) => !r.enabled)
                .map((r) => r.id)
            : [],
        });
      }

      case 'send': {
        const started = Date.now();
        const summary = await runScheduleLint({
          dryRun: false,
          force: true,
          timeRemainingMs: () => TIME_BUDGET_MS - (Date.now() - started),
        });
        console.info(`[schedule-lint] ${actor} ran the lint by hand: ${JSON.stringify(summary)}`);
        return json({ ok: true, summary });
      }

      default:
        return json({ error: 'action must be create, update, delete, preview, or send' }, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed';
    // A Momence outage is the one failure worth naming for the person
    // pressing the button; everything else is ours.
    return json({ error: message }, /Momence|Events API/.test(message) ? 502 : 500);
  }
};
