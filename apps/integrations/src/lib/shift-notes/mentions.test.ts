import { describe, expect, it } from 'vitest';
import { noteMentionPeople } from './mentions';

const holders = [
  { email: 'admin@pyre.test', name: 'Admin', isAdmin: true },
  { email: 'author@pyre.test', name: 'Author', isAdmin: false },
  { email: 'crew@pyre.test', name: 'Crew', isAdmin: false },
];

describe('noteMentionPeople', () => {
  it('offers every holder on a shared note', () => {
    expect(
      noteMentionPeople(holders, { author_email: 'author@pyre.test', admin_only: false }).map(
        (p) => p.email
      )
    ).toEqual(['admin@pyre.test', 'author@pyre.test', 'crew@pyre.test']);
  });

  it('keeps an admins-only note to the admins and its author', () => {
    expect(
      noteMentionPeople(holders, { author_email: 'author@pyre.test', admin_only: true }).map(
        (p) => p.email
      )
    ).toEqual(['admin@pyre.test', 'author@pyre.test']);
  });

  it('keeps a private reply among the admins', () => {
    expect(
      noteMentionPeople(
        holders,
        { author_email: 'author@pyre.test', admin_only: false },
        { privateReply: true }
      )
    ).toEqual([{ email: 'admin@pyre.test', name: 'Admin' }]);
  });
});
