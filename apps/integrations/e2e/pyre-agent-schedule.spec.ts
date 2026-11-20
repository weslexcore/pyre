// Schedule drafts from Pyre Agent: a schedule manager asks the chat to draft
// a week, revise it, and confirm parts of it, and nothing goes live until
// they press Apply. Plus the board's Draft and Revise buttons, which share
// the same run (lib/schedule/draft-run.ts), and the weekly routine that
// replaced the Monday cron.
//
// The agent is the mock Eve app (mock-server/eve.ts): each chat turn is
// scripted as tool calls, which it carries out through the app's real
// /api/agent/pyre, and the spec plays the scheduling agent by saving its
// proposal through /api/agent/proposals. Everything else (the routes, the
// review calls, the database, notifications) is the real thing. Which tool a
// model would pick for a sentence is not tested here.
//
// Browser flows run on every device project; the API matrices run once
// (desktop only).

import { allowConsole, DESKTOP_ONLY_TAG } from '@pyre/e2e-utils';
import { addDays } from '@pyre/schedule-core';
import { SECRETS } from './env';
import {
  ask,
  draftCard,
  eve,
  expect,
  OFF_SHIFT_DUTY,
  openChat,
  proposalNotices,
  pyreOp,
  saveDraft,
  scheduleNotices,
  test,
  weekLabel,
} from './pyre-agent-helpers';
import { ADMIN, REVOCABLE_SCHEDULER, SCHEDULE_VIEWER, SCHEDULER, STAFF, STAFF_2 } from './roles';
import { mock } from './test';

test.describe.configure({ mode: 'parallel' });

const REVIEW_API = '/api/admin/schedule-proposals';
const ACTIONS_API = '/api/admin/agent-actions';

type Db = Parameters<typeof proposalNotices>[0];

async function rows(db: Db, table: string, ids: string[], columns = 'id, is_draft') {
  const { data, error } = await db.from(table).select(columns).in('id', ids);
  expect(error, `read ${table}`).toBeNull();
  return (data ?? []) as unknown as Array<Record<string, unknown>>;
}

async function draftRequests(db: Db, weekStart: string) {
  const { data, error } = await db
    .from('schedule_draft_requests')
    .select('*')
    .eq('week_start', weekStart)
    .order('created_at', { ascending: true });
  expect(error).toBeNull();
  return (data ?? []) as Array<Record<string, unknown>>;
}

async function proposalStatus(db: Db, id: string) {
  const { data, error } = await db
    .from('schedule_proposals')
    .select('status')
    .eq('id', id)
    .single();
  expect(error).toBeNull();
  return (data as { status: string }).status;
}

/** The draft rows of one proposal, by table. */
async function draftItems(db: Db, proposalId: string) {
  const [shifts, assignments, duties] = await Promise.all(
    ['shifts', 'shift_assignments', 'duty_assignments'].map(async (table) => {
      const { data, error } = await db
        .from(table)
        .select('id, is_draft')
        .eq('proposal_id', proposalId);
      expect(error).toBeNull();
      return (data ?? []) as Array<{ id: string; is_draft: boolean }>;
    })
  );
  return { shifts, assignments, duties };
}

/** Assignment ids on a proposal, keyed by `${shiftId}:${staffId}`. */
async function assignmentIds(db: Db, proposalId: string) {
  const { data, error } = await db
    .from('shift_assignments')
    .select('id, shift_id, staff_id')
    .eq('proposal_id', proposalId);
  expect(error).toBeNull();
  return new Map(
    ((data ?? []) as Array<{ id: string; shift_id: string; staff_id: string }>).map((r) => [
      `${r.shift_id}:${r.staff_id}`,
      r.id,
    ])
  );
}

test.describe('drafting from the chat', () => {
  test.use({ storageState: SCHEDULER.storageState as string });

  test('a manager drafts a week, sees it land, and only Apply makes it live', async ({
    page,
    db,
    request,
    week,
    marker,
    seedShift,
    days,
    staffId,
    schedulerSessions,
  }) => {
    const monday = await seedShift({ daysAhead: days.ahead(0) });
    const tuesday = await seedShift({ daysAhead: days.ahead(1) });
    const note = `Give Sam the Monday ${marker}`;
    await eve.script(marker, [
      {
        calls: [{ tool: 'draft_schedule', input: { weekStart: week, note } }],
        answer: `Drafting has started ${marker}.`,
      },
      {
        calls: [
          { tool: 'get_schedule_draft', input: { weekStart: week } },
          {
            tool: 'propose_schedule_review',
            input: { weekStart: week, acceptAll: true, rationale: 'Approve the whole week' },
          },
        ],
        answer: 'The whole draft is ready to confirm below.',
      },
    ]);

    await openChat(page);
    await ask(page, `Draft the week of ${week} ${marker}`, `Drafting has started ${marker}.`);
    const card = draftCard(page, weekLabel(week));
    await expect(card).toContainText('Drafting the week');

    // Recorded as this person's request, from this conversation, with the note.
    const [chat] = await eve.knowledgeSessions(marker);
    const requests = await draftRequests(db, week);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      kind: 'draft',
      origin: 'pyre_agent',
      requested_by: SCHEDULER.email,
      pyre_session_id: chat.id,
      note,
      completed_at: null,
    });
    const [scheduler] = await schedulerSessions();
    expect(scheduler.id).toBe(requests[0].agent_session_id);
    expect(scheduler.messages[0]).toContain(`<admin-note>\n${note}\n</admin-note>`);

    // The scheduling agent saves its draft.
    const proposalId = await saveDraft(request, {
      weekStart: week,
      agentSessionId: scheduler.id,
      summary: { uncoveredShifts: 1, warnings: [`Short a lead on Tuesday ${marker}`] },
      assignments: [
        { shiftId: monday.id, staffId: await staffId(STAFF) },
        { shiftId: tuesday.id, staffId: await staffId(STAFF_2) },
      ],
    });

    await expect(card).toContainText('2 items waiting for review', { timeout: 20_000 });
    await expect(card).toContainText('1 shift left uncovered');
    await expect(card).toContainText(`Short a lead on Tuesday ${marker}`);
    await expect(card.getByRole('link', { name: 'Open on the board' })).toHaveAttribute(
      'href',
      `/admin/schedule?view=week&date=${week}`
    );
    await card.getByText('Show every item').click();
    await expect(card).toContainText(`${monday.label} 10:00am–11:00am · ${STAFF.displayName}`);

    // Nothing is live and nobody has been told.
    const items = await draftItems(db, proposalId);
    expect(items.assignments.every((a) => a.is_draft)).toBe(true);
    expect(await scheduleNotices(db, STAFF.email, [proposalId, monday.id])).toHaveLength(0);

    // Asking to approve only proposes.
    await ask(page, 'Approve it', 'The whole draft is ready to confirm below.');
    const proposed = page.getByRole('region', { name: 'Proposed changes' });
    await expect(proposed).toContainText('Schedule draft');
    await expect(proposed).toContainText('Approve the whole draft');
    expect((await draftItems(db, proposalId)).assignments.every((a) => a.is_draft)).toBe(true);
    expect(await proposalStatus(db, proposalId)).toBe('draft');
    expect(await scheduleNotices(db, STAFF.email, [proposalId, monday.id])).toHaveLength(0);

    await proposed.getByRole('button', { name: 'Apply' }).click();
    await expect(proposed).toContainText('Applied');

    expect(await proposalStatus(db, proposalId)).toBe('approved');
    expect((await draftItems(db, proposalId)).assignments.every((a) => !a.is_draft)).toBe(true);
    const { data: log } = await db
      .from('schedule_changes')
      .select('actor_email, action')
      .eq('entity_id', proposalId)
      .eq('action', 'approve');
    expect(log).toEqual([{ actor_email: SCHEDULER.email, action: 'approve' }]);
    expect(await scheduleNotices(db, STAFF.email, [proposalId])).toHaveLength(1);
    expect(await scheduleNotices(db, STAFF_2.email, [proposalId])).toHaveLength(1);
    // The draft card re-reads the week.
    await expect(card).toContainText("the week's latest one was approved", { timeout: 15_000 });
  });

  test('a revision replaces the card, and the conversation survives a reload', async ({
    page,
    request,
    week,
    marker,
    seedShift,
    staffId,
    schedulerSessions,
  }) => {
    const shift = await seedShift();
    await eve.script(marker, [
      {
        calls: [{ tool: 'draft_schedule', input: { weekStart: week } }],
        answer: `First draft started ${marker}.`,
      },
      {
        calls: [{ tool: 'revise_schedule_draft', input: { weekStart: week, note: 'Use Casey' } }],
        answer: 'Revision sent.',
      },
    ]);

    await openChat(page);
    await ask(page, `Draft ${week} ${marker}`, `First draft started ${marker}.`);
    const [scheduler] = await schedulerSessions();
    await saveDraft(request, {
      weekStart: week,
      agentSessionId: scheduler.id,
      assignments: [{ shiftId: shift.id, staffId: await staffId(STAFF) }],
    });
    const card = draftCard(page, weekLabel(week));
    await expect(card).toContainText('1 item waiting for review', { timeout: 20_000 });

    await ask(page, 'Use Casey instead', 'Revision sent.');
    await expect(card).toContainText('Revising the draft');
    await expect(draftCard(page, weekLabel(week))).toHaveCount(1);

    await saveDraft(request, {
      weekStart: week,
      agentSessionId: scheduler.id,
      assignments: [{ shiftId: shift.id, staffId: await staffId(STAFF_2) }],
    });
    await card.getByText('Show every item').click();
    await expect(card).toContainText(STAFF_2.displayName, { timeout: 20_000 });

    await page.reload();
    await expect(page.getByText('Revision sent.')).toBeVisible();
    await expect(page.getByText(`First draft started ${marker}.`)).toBeVisible();
    await expect(draftCard(page, weekLabel(week))).toHaveCount(1);
    await expect(draftCard(page, weekLabel(week))).toContainText('1 item waiting for review');
  });

  test('leaving the chat: the notice brings the person back to the draft', async ({
    page,
    db,
    request,
    week,
    marker,
    seedShift,
    staffId,
    schedulerSessions,
  }) => {
    const shift = await seedShift();
    await eve.script(marker, [
      {
        calls: [{ tool: 'draft_schedule', input: { weekStart: week } }],
        answer: `Drafting ${marker}.`,
      },
      {
        calls: [{ tool: 'revise_schedule_draft', input: { weekStart: week, note: 'Swap them' } }],
        answer: 'Revising.',
      },
    ]);
    await openChat(page);
    await ask(page, `Draft ${week} ${marker}`, `Drafting ${marker}.`);
    const [chat] = await eve.knowledgeSessions(marker);
    await page.goto('/admin');

    const [scheduler] = await schedulerSessions();
    const first = await saveDraft(request, {
      weekStart: week,
      agentSessionId: scheduler.id,
      assignments: [{ shiftId: shift.id, staffId: await staffId(STAFF) }],
    });
    const [notice] = await proposalNotices(db, SCHEDULER.email, first);
    expect(notice).toMatchObject({
      kind: 'schedule_change',
      href: `/admin/ask?c=${encodeURIComponent(chat.id)}`,
    });
    expect(notice.title).toContain('Draft schedule ready');

    await page.goto(notice.href as string);
    await expect(draftCard(page, weekLabel(week))).toContainText('1 item waiting for review');

    // A revision asked for here is announced the same way.
    await ask(page, 'Swap them', 'Revising.');
    const second = await saveDraft(request, {
      weekStart: week,
      agentSessionId: scheduler.id,
      assignments: [{ shiftId: shift.id, staffId: await staffId(STAFF_2) }],
    });
    const [revised] = await proposalNotices(db, SCHEDULER.email, second);
    expect(revised.title).toContain('Revised draft ready');
    expect(revised.href).toBe(`/admin/ask?c=${encodeURIComponent(chat.id)}`);

    // Every request is settled: another save from the same session tells nobody.
    const third = await saveDraft(request, {
      weekStart: week,
      agentSessionId: scheduler.id,
      assignments: [{ shiftId: shift.id, staffId: await staffId(STAFF) }],
    });
    expect(await proposalNotices(db, SCHEDULER.email, third)).toHaveLength(0);
  });
});

test.describe('a run that never finishes', () => {
  test.use({ storageState: SCHEDULER.storageState as string });

  test('the chat stops waiting after 20 minutes, and the week can be drafted again', async ({
    page,
    db,
    request,
    week,
    marker,
    schedulerSessions,
  }) => {
    await page.clock.install();
    await eve.script(marker, [
      {
        calls: [{ tool: 'draft_schedule', input: { weekStart: week } }],
        answer: `Drafting ${marker}.`,
      },
    ]);
    await openChat(page);
    await ask(page, `Draft ${week} ${marker}`, `Drafting ${marker}.`);
    const card = draftCard(page, weekLabel(week));
    await expect(card).toContainText('Drafting the week');

    // While it runs, a second start is refused.
    const again = await pyreOp(request, SCHEDULER.email, 'schedule_start', { weekStart: week });
    expect(again.status).toBe(409);
    expect(await schedulerSessions()).toHaveLength(1);

    // The run is abandoned: its request is older than the lapse.
    const aged = new Date(Date.now() - 21 * 60 * 1000).toISOString();
    expect(
      (await db.from('schedule_draft_requests').update({ created_at: aged }).eq('week_start', week))
        .error
    ).toBeNull();
    await page.clock.fastForward('21:00');
    await expect(card).toContainText('No draft arrived', { timeout: 15_000 });

    const retry = await pyreOp(request, SCHEDULER.email, 'schedule_start', { weekStart: week });
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(await schedulerSessions()).toHaveLength(2);
  });

  test.describe('a failed read', () => {
    test.use({ consoleAllowlist: allowConsole(/500 \(Internal Server Error\)/) });

    test('the card shows the error and recovers on the next look', {
      tag: DESKTOP_ONLY_TAG,
    }, async ({ page, request, week, marker, seedShift, staffId, schedulerSessions }) => {
      const shift = await seedShift();
      await eve.script(marker, [
        {
          calls: [{ tool: 'draft_schedule', input: { weekStart: week } }],
          answer: `Drafting ${marker}.`,
        },
      ]);
      let failures = 1;
      await page.route(/\/api\/admin\/schedule-draft\?/, (route) =>
        failures-- > 0
          ? route.fulfill({ status: 500, json: { error: 'E2E read failure' } })
          : route.continue()
      );
      await openChat(page);
      await ask(page, `Draft ${week} ${marker}`, `Drafting ${marker}.`);
      const card = draftCard(page, weekLabel(week));
      await expect(card).toContainText('E2E read failure');

      const [scheduler] = await schedulerSessions();
      await saveDraft(request, {
        weekStart: week,
        agentSessionId: scheduler.id,
        assignments: [{ shiftId: shift.id, staffId: await staffId(STAFF) }],
      });
      await expect(card).toContainText('1 item waiting for review', { timeout: 20_000 });
      await expect(card).not.toContainText('E2E read failure');
    });
  });
});

test.describe('confirming parts of a draft', { tag: DESKTOP_ONLY_TAG }, () => {
  test('days and single items are confirmed or dropped exactly as proposed', async ({
    as,
    db,
    request,
    week,
    marker,
    dayOf,
    seedShift,
    days,
    staffId,
    schedulerSessions,
  }) => {
    const sam = await staffId(STAFF);
    const casey = await staffId(STAFF_2);
    const mon = await seedShift({ daysAhead: days.ahead(0) });
    const wed = await seedShift({ daysAhead: days.ahead(2) });
    const fri = await seedShift({ daysAhead: days.ahead(4) });

    const started = await pyreOp(request, SCHEDULER.email, 'schedule_start', { weekStart: week });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const [scheduler] = await schedulerSessions();
    const proposalId = await saveDraft(request, {
      weekStart: week,
      agentSessionId: scheduler.id,
      shifts: [
        {
          key: 'thu',
          shiftDate: dayOf(3),
          label: `E2E shift ${marker} new`,
          startsAt: '12:00',
          endsAt: '14:00',
          staffNeeded: 1,
        },
      ],
      assignments: [
        { shiftId: mon.id, staffId: sam },
        { shiftId: mon.id, staffId: casey },
        { shiftId: wed.id, staffId: sam },
        { shiftKey: 'thu', staffId: sam },
        { shiftId: fri.id, staffId: casey },
      ],
      dutyAssignments: [
        { dutyKey: OFF_SHIFT_DUTY.key, date: dayOf(0), staffId: casey },
        { dutyKey: OFF_SHIFT_DUTY.key, date: dayOf(1), staffId: sam },
      ],
    });

    const draft = (await pyreOp(request, SCHEDULER.email, 'schedule_draft', { weekStart: week }))
      .body as { draft: { items: Array<{ ref: string; kind: string; date: string }> } };
    const byRef = (kind: string, date: string, person?: string) =>
      draft.draft.items.find(
        (i) =>
          i.kind === kind &&
          i.date === date &&
          (!person || (i as { person?: string }).person === person)
      )?.ref as string;
    const wedRef = byRef('assignment', dayOf(2));
    const thuShiftRef = byRef('shift', dayOf(3));
    const thuAssignRef = byRef('assignment', dayOf(3));
    const friRef = byRef('assignment', dayOf(4));
    expect(draft.draft.items).toHaveLength(8);

    const proposed = await pyreOp(
      request,
      SCHEDULER.email,
      'propose',
      {
        kind: 'schedule.review',
        weekStart: week,
        acceptDays: [dayOf(0)],
        accept: [wedRef],
        reject: [thuShiftRef, thuAssignRef, friRef],
        rationale: 'Keep Monday and Wednesday',
      },
      `${marker}-session`
    );
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(200);
    const action = proposed.body.proposal as { id: string; summary: string; status: string };
    expect(action.status).toBe('pending');
    expect(action.summary).toContain('confirm 4 and drop 3 of 8');

    const ids = await assignmentIds(db, proposalId);
    const thuShift = thuShiftRef.split(':')[1];
    const applied = await (await as(SCHEDULER)).post(ACTIONS_API, {
      data: { id: action.id, action: 'apply' },
    });
    expect(applied.status(), await applied.text()).toBe(200);
    expect(
      ((await applied.json()) as { action: { error: string | null } }).action.error
    ).toBeNull();

    // Monday (both people and its duty) and Wednesday are live.
    const live = await rows(db, 'shift_assignments', [
      ids.get(`${mon.id}:${sam}`) as string,
      ids.get(`${mon.id}:${casey}`) as string,
      ids.get(`${wed.id}:${sam}`) as string,
    ]);
    expect(live.map((r) => r.is_draft)).toEqual([false, false, false]);
    const duties = await db
      .from('duty_assignments')
      .select('duty_date, is_draft')
      .eq('proposal_id', proposalId)
      .order('duty_date');
    expect(duties.data).toEqual([
      { duty_date: dayOf(0), is_draft: false },
      { duty_date: dayOf(1), is_draft: true },
    ]);
    // Thursday's new shift and its person, and Friday, are gone.
    expect(await rows(db, 'shifts', [thuShift])).toEqual([]);
    expect(
      await rows(db, 'shift_assignments', [
        ids.get(`${fri.id}:${casey}`) as string,
        thuAssignRef.split(':')[1],
      ])
    ).toEqual([]);
    // Tuesday's duty is still waiting, so the draft is still open.
    expect(await proposalStatus(db, proposalId)).toBe('draft');
  });

  test('a confirmation made against a replaced or decided draft cannot publish', async ({
    as,
    db,
    request,
    week,
    marker,
    seedShift,
    staffId,
    schedulerSessions,
  }) => {
    const shift = await seedShift();
    const sam = await staffId(STAFF);
    const scheduler = await as(SCHEDULER);

    for (const change of ['revised', 'discarded', 'approved'] as const) {
      const started = await pyreOp(request, SCHEDULER.email, 'schedule_start', {
        weekStart: week,
      });
      expect(started.status, JSON.stringify(started.body)).toBe(200);
      const sessions = await schedulerSessions();
      const session = sessions[sessions.length - 1];
      const original = await saveDraft(request, {
        weekStart: week,
        agentSessionId: session.id,
        assignments: [{ shiftId: shift.id, staffId: sam }],
      });
      const proposed = await pyreOp(
        request,
        SCHEDULER.email,
        'propose',
        { kind: 'schedule.review', weekStart: week, acceptAll: true, rationale: change },
        `${marker}-${change}`
      );
      expect(proposed.status, JSON.stringify(proposed.body)).toBe(200);
      const actionId = (proposed.body.proposal as { id: string }).id;

      let replacement: string | null = null;
      if (change === 'revised') {
        replacement = await saveDraft(request, {
          weekStart: week,
          agentSessionId: session.id,
          assignments: [{ shiftId: shift.id, staffId: await staffId(STAFF_2) }],
        });
      } else {
        const decided = await scheduler.post(REVIEW_API, {
          data: { action: change === 'approved' ? 'approve' : 'discard', proposalId: original },
        });
        expect(decided.status(), await decided.text()).toBe(200);
      }
      const noticesBefore = await scheduleNotices(db, STAFF.email, [original, shift.id]);

      const applied = await scheduler.post(ACTIONS_API, {
        data: { id: actionId, action: 'apply' },
      });
      expect(applied.status(), change).toBe(422);
      const body = (await applied.json()) as { action: { status: string; error: string } };
      expect(body.action.status).toBe('pending');
      expect(body.action.error).toContain('no longer open');

      expect(await scheduleNotices(db, STAFF.email, [original, shift.id])).toHaveLength(
        noticesBefore.length
      );
      if (replacement) {
        expect(await proposalStatus(db, replacement)).toBe('draft');
        expect((await draftItems(db, replacement)).assignments.every((a) => a.is_draft)).toBe(true);
        expect(await scheduleNotices(db, STAFF_2.email, [replacement, shift.id])).toHaveLength(0);
        // Clear the way for the next round.
        await scheduler.post(REVIEW_API, { data: { action: 'discard', proposalId: replacement } });
      }
      if (change === 'approved') {
        // Take the live assignment off again so the shift is open for nothing else.
        await db.from('shift_assignments').delete().eq('proposal_id', original);
      }
    }
  });

  test('applying twice publishes once; a partly decided review applies the rest', async ({
    as,
    db,
    request,
    week,
    marker,
    seedShift,
    days,
    staffId,
    schedulerSessions,
  }) => {
    const sam = await staffId(STAFF);
    const casey = await staffId(STAFF_2);
    const mon = await seedShift({ daysAhead: days.ahead(0) });
    const tue = await seedShift({ daysAhead: days.ahead(1) });
    const wed = await seedShift({ daysAhead: days.ahead(2) });
    const scheduler = await as(SCHEDULER);
    await pyreOp(request, SCHEDULER.email, 'schedule_start', { weekStart: week });
    const [session] = await schedulerSessions();
    const proposalId = await saveDraft(request, {
      weekStart: week,
      agentSessionId: session.id,
      assignments: [
        { shiftId: mon.id, staffId: sam },
        { shiftId: tue.id, staffId: casey },
        { shiftId: wed.id, staffId: sam },
      ],
    });
    const ids = await assignmentIds(db, proposalId);
    const monA = ids.get(`${mon.id}:${sam}`) as string;
    const tueA = ids.get(`${tue.id}:${casey}`) as string;
    const wedA = ids.get(`${wed.id}:${sam}`) as string;
    const propose = async (input: Record<string, unknown>, suffix: string) => {
      const result = await pyreOp(
        request,
        SCHEDULER.email,
        'propose',
        { kind: 'schedule.review', weekStart: week, rationale: suffix, ...input },
        `${marker}-${suffix}`
      );
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      return (result.body.proposal as { id: string }).id;
    };

    // Two tabs press Apply at once: one goes through.
    const both = await propose({ accept: [`assignment:${monA}`] }, 'twice');
    const statuses = (
      await Promise.all(
        [0, 1].map(() => scheduler.post(ACTIONS_API, { data: { id: both, action: 'apply' } }))
      )
    ).map((r) => r.status());
    expect(statuses.sort()).toEqual([200, 409]);
    // Published once: one accept in the change log. (A single accepted shift
    // this far out tells nobody yet; the week's roundup does.)
    const { data: accepts } = await db
      .from('schedule_changes')
      .select('id')
      .eq('entity_id', monA)
      .eq('action', 'accept_item');
    expect(accepts).toHaveLength(1);

    // One item decided on the board first: the other still applies, and the card says so.
    const partial = await propose(
      { accept: [`assignment:${tueA}`, `assignment:${wedA}`] },
      'partial'
    );
    const onBoard = await scheduler.post(REVIEW_API, {
      data: { action: 'accept-item', kind: 'assignment', id: tueA },
    });
    expect(onBoard.status()).toBe(200);
    const applied = await scheduler.post(ACTIONS_API, { data: { id: partial, action: 'apply' } });
    expect(applied.status()).toBe(200);
    const action = ((await applied.json()) as { action: { status: string; error: string } }).action;
    expect(action.status).toBe('applied');
    expect(action.error).toContain('1 of 2 could not be applied');
    expect((await rows(db, 'shift_assignments', [wedA]))[0].is_draft).toBe(false);

    // Every item it names was decided elsewhere: it stays pending with the reason.
    await saveDraft(request, {
      weekStart: week,
      agentSessionId: session.id,
      assignments: [
        { shiftId: wed.id, staffId: casey },
        { shiftId: mon.id, staffId: casey },
      ],
    });
    const fresh = await assignmentIds(db, (await openProposalId(db, week)) as string);
    const lone = fresh.get(`${wed.id}:${casey}`) as string;
    const doomed = await propose({ accept: [`assignment:${lone}`] }, 'doomed');
    await scheduler.post(REVIEW_API, {
      data: { action: 'reject-item', kind: 'assignment', id: lone },
    });
    const refused = await scheduler.post(ACTIONS_API, { data: { id: doomed, action: 'apply' } });
    expect(refused.status()).toBe(422);
    const refusedAction = ((await refused.json()) as { action: { status: string; error: string } })
      .action;
    expect(refusedAction.status).toBe('pending');
    expect(refusedAction.error).toContain('Draft item not found');
  });
});

async function openProposalId(db: Db, week: string): Promise<string | null> {
  const { data } = await db
    .from('schedule_proposals')
    .select('id')
    .eq('week_start', week)
    .eq('status', 'draft')
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

test.describe('who may draft and confirm', { tag: DESKTOP_ONLY_TAG }, () => {
  test('managers, admins included, may; viewers may not, by any route', async ({
    as,
    db,
    request,
    week,
    marker,
    seedShift,
    staffId,
    schedulerSessions,
  }) => {
    // An admin and a non-admin manager without boards both read and start.
    for (const role of [ADMIN, SCHEDULER]) {
      const read = await pyreOp(request, role.email, 'schedule_draft', { weekStart: week });
      expect(read.status, role.email).toBe(200);
      const viaPage = await (await as(role)).get(`/api/admin/schedule-draft?weekStart=${week}`);
      expect(viaPage.status(), role.email).toBe(200);
    }
    const byAdmin = await pyreOp(request, ADMIN.email, 'schedule_start', { weekStart: week });
    expect(byAdmin.status, JSON.stringify(byAdmin.body)).toBe(200);
    expect((await draftRequests(db, week))[0]).toMatchObject({ requested_by: ADMIN.email });

    // A schedule viewer can do none of it.
    const viewer = SCHEDULE_VIEWER.email;
    for (const [op, input] of [
      ['schedule_draft', { weekStart: week }],
      ['schedule_start', { weekStart: week }],
      ['schedule_revise', { weekStart: week, note: 'x' }],
      ['propose', { kind: 'schedule.review', weekStart: week, acceptAll: true, rationale: 'x' }],
    ] as const) {
      const result = await pyreOp(request, viewer, op, input, `${marker}-viewer`);
      expect(result.status, op).toBe(403);
    }
    const viewerPage = await as(SCHEDULE_VIEWER);
    expect((await viewerPage.get(`/api/admin/schedule-draft?weekStart=${week}`)).status()).toBe(
      403
    );
    expect(
      (await viewerPage.post('/api/admin/schedule-draft', { data: { weekStart: week } })).status()
    ).toBe(403);
    expect(await schedulerSessions()).toHaveLength(1);

    // Someone else cannot apply the requester's confirmation.
    const shift = await seedShift();
    const [session] = await schedulerSessions();
    const proposalId = await saveDraft(request, {
      weekStart: week,
      agentSessionId: session.id,
      assignments: [{ shiftId: shift.id, staffId: await staffId(STAFF) }],
    });
    const proposed = await pyreOp(
      request,
      SCHEDULER.email,
      'propose',
      { kind: 'schedule.review', weekStart: week, acceptAll: true, rationale: 'mine' },
      `${marker}-owner`
    );
    const actionId = (proposed.body.proposal as { id: string }).id;
    const byOther = await (await as(ADMIN)).post(ACTIONS_API, {
      data: { id: actionId, action: 'apply' },
    });
    expect(byOther.status()).toBe(404);
    expect(await proposalStatus(db, proposalId)).toBe('draft');
  });

  test('a manager whose grant is taken away before Apply cannot publish', async ({
    as,
    db,
    request,
    week,
    marker,
    seedShift,
    staffId,
    schedulerSessions,
  }) => {
    const shift = await seedShift();
    const admin = await as(ADMIN);
    const { data: person } = await db
      .from('staff')
      .select('id, pages')
      .eq('email', REVOCABLE_SCHEDULER.email)
      .single();
    const { id, pages } = person as { id: string; pages: string[] };

    try {
      await pyreOp(request, REVOCABLE_SCHEDULER.email, 'schedule_start', { weekStart: week });
      const [session] = await schedulerSessions();
      const proposalId = await saveDraft(request, {
        weekStart: week,
        agentSessionId: session.id,
        assignments: [{ shiftId: shift.id, staffId: await staffId(STAFF) }],
      });
      const proposed = await pyreOp(
        request,
        REVOCABLE_SCHEDULER.email,
        'propose',
        { kind: 'schedule.review', weekStart: week, acceptAll: true, rationale: 'before' },
        `${marker}-revoked`
      );
      expect(proposed.status).toBe(200);
      const actionId = (proposed.body.proposal as { id: string }).id;

      const revoked = await admin.patch('/api/admin/users', {
        data: { id, pages: ['/admin/ask', '/admin/schedule'] },
      });
      expect(revoked.status(), await revoked.text()).toBe(200);

      const applied = await (await as(REVOCABLE_SCHEDULER)).post(ACTIONS_API, {
        data: { id: actionId, action: 'apply' },
      });
      expect(applied.status()).toBe(422);
      expect(await proposalStatus(db, proposalId)).toBe('draft');
      expect(await scheduleNotices(db, STAFF.email, [proposalId, shift.id])).toHaveLength(0);
    } finally {
      const restored = await admin.patch('/api/admin/users', { data: { id, pages } });
      expect(restored.status(), 'restore the grant').toBe(200);
    }
  });
});

test.describe('revising', { tag: DESKTOP_ONLY_TAG }, () => {
  test('a parked session gets a follow-up; an ended one is replayed into a new one', async ({
    as,
    db,
    request,
    week,
    seedShift,
    days,
    staffId,
    schedulerSessions,
  }) => {
    const sam = await staffId(STAFF);
    const casey = await staffId(STAFF_2);
    const mon = await seedShift({ daysAhead: days.ahead(0) });
    const tue = await seedShift({ daysAhead: days.ahead(1) });
    await pyreOp(request, SCHEDULER.email, 'schedule_start', {
      weekStart: week,
      note: 'First note',
    });
    const [first] = await schedulerSessions();
    const original = await saveDraft(request, {
      weekStart: week,
      agentSessionId: first.id,
      assignments: [
        { shiftId: mon.id, staffId: sam },
        { shiftId: tue.id, staffId: casey },
      ],
    });
    // Monday is confirmed on the board before any revision.
    const confirmed = (await assignmentIds(db, original)).get(`${mon.id}:${sam}`) as string;
    await (await as(SCHEDULER)).post(REVIEW_API, {
      data: { action: 'accept-item', kind: 'assignment', id: confirmed },
    });

    // Parked: the note goes into the same session.
    const parked = await pyreOp(request, SCHEDULER.email, 'schedule_revise', {
      weekStart: week,
      note: 'Second note',
    });
    expect(parked.status, JSON.stringify(parked.body)).toBe(200);
    const resumed = await eve.session(first.id);
    expect(resumed.messages).toHaveLength(2);
    expect(resumed.messages[1]).toContain('Second note');
    expect(resumed.messages[1]).toContain('wants changes');
    const revised = await saveDraft(request, {
      weekStart: week,
      agentSessionId: first.id,
      assignments: [{ shiftId: tue.id, staffId: sam }],
    });
    expect(await proposalStatus(db, original)).toBe('superseded');
    expect((await rows(db, 'shift_assignments', [confirmed]))[0].is_draft).toBe(false);

    // Ended: a fresh session carries the conversation so far.
    await eve.setState(first.id, 'gone');
    const replayed = await pyreOp(request, SCHEDULER.email, 'schedule_revise', {
      weekStart: week,
      note: 'Third note',
    });
    expect(replayed.status, JSON.stringify(replayed.body)).toBe(200);
    const sessions = await schedulerSessions();
    expect(sessions).toHaveLength(2);
    const fresh = sessions[1];
    expect(fresh.messages[0]).toContain('no longer available');
    expect(fresh.messages[0]).toContain('Second note');
    expect(fresh.messages[0]).toContain('Third note');
    const { data: thread } = await db
      .from('schedule_draft_messages')
      .select('agent_session_id')
      .eq('week_start', week);
    expect(new Set((thread ?? []).map((t) => t.agent_session_id))).toEqual(new Set([fresh.id]));
    const last = await saveDraft(request, {
      weekStart: week,
      agentSessionId: fresh.id,
      assignments: [{ shiftId: tue.id, staffId: casey }],
    });
    expect(await proposalStatus(db, revised)).toBe('superseded');
    expect(await proposalStatus(db, last)).toBe('draft');
    expect((await rows(db, 'shift_assignments', [confirmed]))[0].is_draft).toBe(false);
    expect((await draftRequests(db, week)).map((r) => r.kind)).toEqual([
      'draft',
      'refine',
      'refine',
    ]);
  });

  test('a busy scheduler is not sent a second revision', async ({
    request,
    week,
    seedShift,
    staffId,
    schedulerSessions,
  }) => {
    const shift = await seedShift();
    await pyreOp(request, SCHEDULER.email, 'schedule_start', { weekStart: week });
    const [session] = await schedulerSessions();
    await saveDraft(request, {
      weekStart: week,
      agentSessionId: session.id,
      assignments: [{ shiftId: shift.id, staffId: await staffId(STAFF) }],
    });
    await eve.setState(session.id, 'running');
    const busy = await pyreOp(request, SCHEDULER.email, 'schedule_revise', {
      weekStart: week,
      note: 'Not now',
    });
    expect(busy.status).toBe(409);
    expect((await eve.session(session.id)).messages).toHaveLength(1);
    expect(await schedulerSessions()).toHaveLength(1);
  });

  test('a scheduler that cannot start is reported, and nothing is left waiting', async ({
    db,
    request,
    week,
  }) => {
    const id = await mock.override({
      method: 'POST',
      path: '/agents/eve/v1/session',
      status: 500,
      json: { error: 'E2E agent down' },
      bodyIncludes: week,
    });
    try {
      const failed = await pyreOp(request, SCHEDULER.email, 'schedule_start', { weekStart: week });
      expect(failed.status).toBe(502);
      expect(String(failed.body.error)).toContain('Agent session');
      expect(await draftRequests(db, week)).toEqual([]);
    } finally {
      await mock.removeOverride(id);
    }
  });
});

test.describe('the board after the shared-run refactor', { tag: DESKTOP_ONLY_TAG }, () => {
  test('draft several weeks with a note, then revise', async ({
    as,
    db,
    request,
    week,
    days,
    seedShift,
    staffId,
  }) => {
    const past = addDays(week, days.past(0) - days.ahead(0));
    const board = await as(SCHEDULER);
    try {
      const drafted = await board.post('/api/admin/schedule-draft', {
        data: { weekStarts: [week, past, week], prompt: 'Board note' },
      });
      expect(drafted.status(), await drafted.text()).toBe(202);
      const body = (await drafted.json()) as {
        ok: boolean;
        sessions: Array<{ weekStart: string; sessionId: string }>;
        weekStart: string;
        sessionId: string;
        sync: unknown;
      };
      expect(body.ok).toBe(true);
      expect(body.sessions.map((s) => s.weekStart)).toEqual([past, week]);
      expect(body.weekStart).toBe(past);
      expect(body.sessionId).toBe(body.sessions[0].sessionId);
      expect(body.sync).toBeTruthy();
      for (const { weekStart, sessionId } of body.sessions) {
        const session = await eve.session(sessionId);
        expect(session.messages[0]).toContain(`week starting ${weekStart}`);
        expect(session.messages[0]).toContain('<admin-note>\nBoard note\n</admin-note>');
        expect(await draftRequests(db, weekStart)).toEqual([
          expect.objectContaining({
            origin: 'board',
            kind: 'draft',
            requested_by: SCHEDULER.email,
            agent_session_id: sessionId,
          }),
        ]);
      }

      // The board's own drafts tell nobody: the board is polling for them.
      const shift = await seedShift();
      const sessionId = body.sessions[1].sessionId;
      const proposalId = await saveDraft(request, {
        weekStart: week,
        agentSessionId: sessionId,
        assignments: [{ shiftId: shift.id, staffId: await staffId(STAFF) }],
      });
      expect(await proposalNotices(db, SCHEDULER.email, proposalId)).toEqual([]);

      const refined = await board.post('/api/admin/schedule-draft-refine', {
        data: { weekStart: week, prompt: 'Board revision' },
      });
      expect(refined.status(), await refined.text()).toBe(202);
      expect(await refined.json()).toEqual({ ok: true, weekStart: week, sessionId, resumed: true });
      expect((await eve.session(sessionId)).messages[1]).toContain('Board revision');
      const empty = await board.post('/api/admin/schedule-draft-refine', {
        data: { weekStart: week, prompt: '   ' },
      });
      expect(empty.status()).toBe(400);
    } finally {
      await db.from('schedule_draft_messages').delete().eq('week_start', past);
      await db.from('schedule_draft_requests').delete().eq('week_start', past);
    }
  });
});

test.describe('the weekly routine', { tag: DESKTOP_ONLY_TAG }, () => {
  test('a Monday routine drafts as its owner, and the draft waits for Apply', async ({
    as,
    db,
    request,
    week,
    marker,
    seedShift,
    staffId,
  }) => {
    const shift = await seedShift();
    await eve.script(marker, [
      {
        calls: [{ tool: 'draft_schedule', input: { weekStart: week } }],
        answer: `Started the draft for the week of ${week}.`,
      },
    ]);
    const owner = await as(SCHEDULER);
    const created = await owner.post('/api/admin/agent-routines', {
      data: {
        title: `Draft next week ${marker}`,
        prompt: `Draft next week's schedule ${marker}`,
        frequency: 'weekly',
        weekdays: [1],
        hour: 9,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const routineId = ((await created.json()) as { routine: { id: string } }).routine.id;

    try {
      // Due now.
      await db
        .from('pyre_agent_routines')
        .update({ next_run_at: new Date(Date.now() - 60_000).toISOString() })
        .eq('id', routineId);
      const tick = await request.get('/api/cron/tick?job=pyre-agent-routines', {
        headers: { authorization: `Bearer ${SECRETS.cron}` },
        timeout: 60_000,
      });
      expect(tick.status()).toBe(200);

      const [chat] = await eve.knowledgeSessions(marker);
      expect(chat.scope).toMatchObject({ email: SCHEDULER.email, scheduleManage: true });
      expect(chat.routineRunId).toBeTruthy();
      await expect
        .poll(async () => {
          const { data: run } = await db
            .from('pyre_agent_routine_runs')
            .select('status, trigger, session_id')
            .eq('id', chat.routineRunId as string)
            .single();
          return run;
        })
        .toEqual({ status: 'answered', trigger: 'scheduled', session_id: chat.id });

      const [requestRow] = await draftRequests(db, week);
      expect(requestRow).toMatchObject({
        origin: 'pyre_agent',
        requested_by: SCHEDULER.email,
        pyre_session_id: chat.id,
      });

      const proposalId = await saveDraft(request, {
        weekStart: week,
        agentSessionId: requestRow.agent_session_id as string,
        assignments: [{ shiftId: shift.id, staffId: await staffId(STAFF) }],
      });
      const [notice] = await proposalNotices(db, SCHEDULER.email, proposalId);
      expect(notice.href).toBe(`/admin/ask?c=${encodeURIComponent(chat.id)}`);
      expect(await proposalStatus(db, proposalId)).toBe('draft');
      expect((await draftItems(db, proposalId)).assignments.every((a) => a.is_draft)).toBe(true);
      expect(await scheduleNotices(db, STAFF.email, [proposalId, shift.id])).toHaveLength(0);
    } finally {
      const { data: runs } = await db
        .from('pyre_agent_routine_runs')
        .select('id')
        .eq('routine_id', routineId);
      const runIds = (runs ?? []).map((r) => r.id as string);
      if (runIds.length > 0) {
        await db.from('staff_notifications').delete().in('source_id', runIds);
      }
      await db.from('pyre_agent_routine_runs').delete().eq('routine_id', routineId);
      await db.from('pyre_agent_routines').delete().eq('id', routineId);
    }
  });
});
