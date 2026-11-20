// Staff messages: an admin posts to an audience, the people in it read,
// acknowledge and reply, and nobody outside it can see the message. Every
// test posts its own messages with a unique title.

import { DESKTOP_ONLY_TAG, uniqueTag } from '@pyre/e2e-utils';
import { ADMIN, SHIFT_LEAD, STAFF, STAFF_2 } from './roles';
import { postMessage } from './sops-helpers';
import { expect, mock, open, test } from './test';

test.describe('reading a message', () => {
  test.use({ storageState: STAFF.storageState as string });

  test('staff in the audience are told, read it, acknowledge and reply', async ({
    page,
    as,
    db,
  }, testInfo) => {
    const title = uniqueTag(testInfo, 'New towel policy');
    const { message } = await postMessage(await as(ADMIN), {
      title,
      bodyMd: 'Fold towels in thirds from today.',
      audienceEmails: [STAFF.email, STAFF_2.email],
      requiresAck: true,
    });

    const { data: notice, error: noticeError } = await db
      .from('staff_notifications')
      .select('kind, read_at')
      .eq('recipient_email', STAFF.email)
      .eq('source_id', message.id)
      .single();
    expect(noticeError).toBeNull();
    expect(notice).toEqual({ kind: 'admin_message', read_at: null });

    await open(page, '/admin/messages');
    await page
      .getByRole('link', { name: new RegExp(title) })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/admin/messages/${message.id}$`));
    await expect(page.getByText('Fold towels in thirds from today.')).toBeVisible();

    // Opening the message marked its notice read, before anything else could
    // (acknowledging marks it read too).
    const { data: read, error: readError } = await db
      .from('staff_notifications')
      .select('read_at')
      .eq('recipient_email', STAFF.email)
      .eq('source_id', message.id)
      .eq('kind', 'admin_message')
      .single();
    expect(readError).toBeNull();
    expect(Date.parse(read?.read_at ?? ''), 'read_at is a timestamp').not.toBeNaN();

    await page.getByRole('button', { name: "I've read this" }).click();
    await expect(page.getByText('Acknowledged.')).toBeVisible();

    // Mention a teammate the way a person does: type @ and pick them.
    const box = page.getByRole('textbox', { name: `Reply to ${title}` });
    await box.fill('Got it, ');
    await box.pressSequentially('@Case');
    await page
      .getByRole('listbox', { name: 'Mention someone' })
      .getByRole('option', { name: new RegExp(STAFF_2.displayName) })
      .click();
    await expect(box).toHaveValue(new RegExp(`@${STAFF_2.email}`));
    await page.getByRole('button', { name: 'Reply', exact: true }).click();
    await expect(page.getByText('Got it,')).toBeVisible();

    const { data: acks, error: acksError } = await db
      .from('admin_message_acks')
      .select('email')
      .eq('message_id', message.id);
    expect(acksError).toBeNull();
    expect(acks).toEqual([{ email: STAFF.email }]);

    await expect
      .poll(async () => {
        const { data } = await db
          .from('staff_notifications')
          .select('recipient_email, kind')
          .eq('source_id', message.id)
          .in('kind', ['mention', 'message_reply']);
        return (data ?? []).map((n) => `${n.kind}:${n.recipient_email}`).sort();
      })
      // The mentioned teammate hears about the mention; the author about the reply.
      .toEqual([`mention:${STAFF_2.email}`, `message_reply:${ADMIN.email}`].sort());
  });
});

test.describe('the messages API', { tag: DESKTOP_ONLY_TAG }, () => {
  test('people outside the audience cannot see or answer it', async ({ as }, testInfo) => {
    const { message } = await postMessage(await as(ADMIN), {
      title: uniqueTag(testInfo, 'For staff only'),
      audienceEmails: [STAFF.email],
    });
    const lead = await as(SHIFT_LEAD);

    expect((await lead.get(`/api/admin/messages?id=${message.id}`)).status()).toBe(404);
    const list = (await (await lead.get('/api/admin/messages')).json()) as {
      messages: { id: string }[];
    };
    expect(list.messages.map((m) => m.id)).not.toContain(message.id);
    const reply = await lead.post('/api/admin/message-replies', {
      data: { messageId: message.id, bodyMd: 'Can I see this?' },
    });
    expect(reply.status()).toBe(404);
  });

  test('acknowledging is once, and only where it is asked for', async ({ as, db }, testInfo) => {
    const admin = await as(ADMIN);
    const staff = await as(STAFF);
    const { message: asks } = await postMessage(admin, {
      title: uniqueTag(testInfo, 'Ack me'),
      audienceEmails: [STAFF.email],
      requiresAck: true,
    });

    const first = await staff.post('/api/admin/message-acks', { data: { messageId: asks.id } });
    expect(first.status()).toBe(200);
    const second = await staff.post('/api/admin/message-acks', { data: { messageId: asks.id } });
    expect(second.status()).toBe(200);
    // The second acknowledgement keeps the first one's time.
    const at = async (response: typeof first) => {
      const { acknowledgedAt } = (await response.json()) as { acknowledgedAt?: string };
      expect(Date.parse(acknowledgedAt ?? ''), 'acknowledgedAt is a timestamp').not.toBeNaN();
      return acknowledgedAt as string;
    };
    const firstAt = await at(first);
    expect(await at(second)).toBe(firstAt);
    const { data: ackRows, error: ackError } = await db
      .from('admin_message_acks')
      .select('acknowledged_at')
      .eq('message_id', asks.id);
    expect(ackError).toBeNull();
    expect(ackRows).toHaveLength(1);
    expect(Date.parse(ackRows?.[0]?.acknowledged_at)).toBe(Date.parse(firstAt as string));

    // The author doesn't acknowledge their own message.
    const own = await admin.post('/api/admin/message-acks', { data: { messageId: asks.id } });
    expect(own.status()).toBe(409);

    // Nor does anyone acknowledge one that doesn't ask for it.
    const { message: plain } = await postMessage(admin, {
      title: uniqueTag(testInfo, 'FYI'),
      audienceEmails: [STAFF.email],
    });
    const fyi = await staff.post('/api/admin/message-acks', { data: { messageId: plain.id } });
    expect(fyi.status()).toBe(409);
  });

  test('a draft is the author’s until it is sent, and is sent once', async ({
    as,
    db,
  }, testInfo) => {
    const admin = await as(ADMIN);
    const staff = await as(STAFF);
    const { message: draft } = await postMessage(admin, {
      title: uniqueTag(testInfo, 'Draft'),
      audienceEmails: [STAFF.email],
      draft: true,
    });

    expect((await staff.get(`/api/admin/messages?id=${draft.id}`)).status()).toBe(404);
    const { count: before } = await db
      .from('staff_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('source_id', draft.id)
      .eq('kind', 'admin_message');
    expect(before).toBe(0);
    const early = await admin.post('/api/admin/message-replies', {
      data: { messageId: draft.id, bodyMd: 'Too soon' },
    });
    expect(early.status()).toBe(409);

    const sent = await admin.patch('/api/admin/messages', {
      data: { id: draft.id, send: true, email: false },
    });
    expect(sent.status(), await sent.text()).toBe(200);
    expect((await staff.get(`/api/admin/messages?id=${draft.id}`)).status()).toBe(200);
    const { count: after } = await db
      .from('staff_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('source_id', draft.id)
      .eq('recipient_email', STAFF.email)
      .eq('kind', 'admin_message');
    expect(after).toBe(1);

    const again = await admin.patch('/api/admin/messages', { data: { id: draft.id, send: true } });
    expect(again.status()).toBe(409);
  });

  test('sending a draft twice at once sends it once', async ({ as, db }, testInfo) => {
    const admin = await as(ADMIN);
    const { message: draft } = await postMessage(admin, {
      title: uniqueTag(testInfo, 'Double send'),
      audienceEmails: [STAFF.email, STAFF_2.email],
      draft: true,
    });

    // Two tabs (or a double tap) send the same draft at the same moment.
    const second = await as(ADMIN);
    const responses = await Promise.all(
      [admin, second].map((client) =>
        client.patch('/api/admin/messages', { data: { id: draft.id, send: true, email: false } })
      )
    );
    const statuses = responses.map((response) => response.status()).sort();
    expect(statuses).toEqual([200, 409]);

    // One send: each person in the audience is notified once.
    const { data: notices, error } = await db
      .from('staff_notifications')
      .select('recipient_email')
      .eq('source_id', draft.id)
      .eq('kind', 'admin_message');
    expect(error).toBeNull();
    expect((notices ?? []).map((n) => n.recipient_email).sort()).toEqual(
      [STAFF.email, STAFF_2.email].sort()
    );
    const { data: sent, error: sentError } = await db
      .from('admin_messages')
      .select('sent_at')
      .eq('id', draft.id)
      .single();
    expect(sentError).toBeNull();
    expect(Date.parse(sent?.sent_at ?? '')).not.toBeNaN();
  });

  test('only admins post, and a stale edit is refused', async ({ as }, testInfo) => {
    const staff = await as(STAFF);
    const refused = await staff.post('/api/admin/messages', {
      data: { title: 'Not mine to send', bodyMd: 'x', audienceRoles: ['staff'], email: false },
    });
    expect(refused.status()).toBe(403);

    const admin = await as(ADMIN);
    const { message } = await postMessage(admin, {
      title: uniqueTag(testInfo, 'Editable'),
      audienceEmails: [STAFF.email],
    });
    const edited = await admin.patch('/api/admin/messages', {
      data: { id: message.id, bodyMd: 'First edit', expectedUpdatedAt: message.updated_at },
    });
    expect(edited.status()).toBe(200);
    const stale = await admin.patch('/api/admin/messages', {
      data: { id: message.id, bodyMd: 'Second edit', expectedUpdatedAt: message.updated_at },
    });
    expect(stale.status()).toBe(409);
  });

  test('template names are unique, whatever the case', async ({ as }, testInfo) => {
    const admin = await as(ADMIN);
    const name = uniqueTag(testInfo, 'Weekly reminder');
    const template = { title: 'Reminder', bodyMd: 'Hello', audienceRoles: ['staff'] };

    const created = await admin.post('/api/admin/message-templates', {
      data: { name, ...template },
    });
    expect(created.status()).toBe(201);
    const { template: row } = (await created.json()) as { template: { id: string } };
    try {
      const duplicate = await admin.post('/api/admin/message-templates', {
        data: { name: name.toUpperCase(), ...template },
      });
      expect(duplicate.status()).toBe(409);
    } finally {
      await admin.delete(`/api/admin/message-templates?id=${row.id}`);
    }
  });

  test('staff cannot switch off messages or mentions', async ({ as }) => {
    const staff = await as(STAFF);
    const prefs = (await (await staff.get('/api/admin/notification-prefs')).json()) as {
      kinds: { kind: string; required?: boolean }[];
    };
    const required = prefs.kinds.filter((k) => k.required).map((k) => k.kind);
    expect(required).toEqual(expect.arrayContaining(['admin_message', 'mention']));

    for (const kind of ['admin_message', 'mention']) {
      const response = await staff.put('/api/admin/notification-prefs', {
        data: { muted: [kind] },
      });
      expect(response.status(), kind).toBe(400);
    }
  });
});

// The admin-message email is not live under test (EMAIL_LIVE_TEMPLATES is
// blank), so it reaches only whitelisted addresses. One test whitelists one
// recipient through the admin API (which also clears the app's gate cache),
// checks the send reached Resend, and removes the address again.
test.describe('email', { tag: DESKTOP_ONLY_TAG }, () => {
  test.describe.configure({ mode: 'serial' });

  test('a gated template reaches only a whitelisted recipient', async ({ as }, testInfo) => {
    const admin = await as(ADMIN);
    const recipient = SHIFT_LEAD.email;
    const gate = (action: string) =>
      admin.post('/api/admin/email-gate', { data: { action, email: recipient } });

    const gated = await postMessage(admin, {
      title: uniqueTag(testInfo, 'Gated'),
      audienceEmails: [recipient],
      email: true,
    });
    expect(gated.emailed).toBe(0);

    expect((await gate('add-whitelist')).status()).toBe(200);
    try {
      const title = uniqueTag(testInfo, 'Whitelisted');
      const sent = await postMessage(admin, { title, audienceEmails: [recipient], email: true });
      expect(sent.emailed).toBe(1);

      const emails = (await mock.requests()).filter((r) => r.path === '/resend/emails');
      const delivered = emails.find((r) => JSON.stringify(r.body).includes(title));
      expect(delivered, 'the message email at Resend').toBeTruthy();
      expect(JSON.stringify((delivered?.body as { to?: unknown })?.to)).toContain(recipient);
    } finally {
      await gate('remove-whitelist');
    }
  });
});
