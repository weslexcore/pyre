import { describe, expect, it } from 'vitest';
import { hasBearer } from './bearer';
import { dbError, isUuid, json } from './json';
import { readJsonBody } from './route';

const post = (body: string, type = 'application/json') =>
  new Request('https://x.test/api', { method: 'POST', body, headers: { 'content-type': type } });

describe('json', () => {
  it('sets status and no-store JSON headers', async () => {
    const res = json({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('readJsonBody', () => {
  it('parses an object body', async () => {
    expect(await readJsonBody(post('{"a":1}'))).toEqual({ a: 1 });
  });

  it('415s the wrong content type and 400s bad bodies', async () => {
    expect(((await readJsonBody(post('{}', 'text/plain'))) as Response).status).toBe(415);
    expect(((await readJsonBody(post('nope'))) as Response).status).toBe(400);
    expect(((await readJsonBody(post('[1]'))) as Response).status).toBe(400);
  });
});

describe('dbError', () => {
  it('maps a unique violation to 409 only when a conflict message is given', () => {
    expect(dbError({ message: 'dup', code: '23505' }, 'Already exists').status).toBe(409);
    expect(dbError({ message: 'dup', code: '23505' }).status).toBe(500);
    expect(dbError({ message: 'boom' }, 'Already exists').status).toBe(500);
  });
});

describe('isUuid', () => {
  it('accepts UUIDs only', () => {
    expect(isUuid('2f0a0c6e-0000-4000-8000-000000000000')).toBe(true);
    expect(isUuid('nope')).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});

describe('hasBearer', () => {
  const withAuth = (value?: string) =>
    new Request('https://x.test', { headers: value ? { Authorization: value } : {} });

  it('accepts exactly Bearer <secret>', () => {
    expect(hasBearer(withAuth('Bearer abc'), 'abc', 't')).toBe(true);
    expect(hasBearer(withAuth('Bearer abd'), 'abc', 't')).toBe(false);
    expect(hasBearer(withAuth('Bearer abcd'), 'abc', 't')).toBe(false);
    expect(hasBearer(withAuth(), 'abc', 't')).toBe(false);
  });

  it('rejects everything when unconfigured', () => {
    expect(hasBearer(withAuth('Bearer '), undefined, 't')).toBe(false);
  });
});
