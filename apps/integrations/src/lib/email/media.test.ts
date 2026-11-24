import { describe, expect, it } from 'vitest';
import { blockContentSchema } from '@/lib/email/journeys/schema';
import { EMAIL_MEDIA_MAX_BYTES, emailMediaPath, emailMediaProblem } from './media';

describe('emailMediaProblem', () => {
  it('takes the formats every mail client shows, up to 5 MB', () => {
    expect(emailMediaProblem({ type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(emailMediaProblem({ type: 'image/png', size: EMAIL_MEDIA_MAX_BYTES })).toBeNull();
    expect(emailMediaProblem({ type: 'image/webp', size: 1000 })).toMatch(/JPG, PNG or GIF/);
    expect(emailMediaProblem({ type: 'image/png', size: EMAIL_MEDIA_MAX_BYTES + 1 })).toMatch(
      /over 5 MB/
    );
  });
});

describe('emailMediaPath', () => {
  it('files uploads by month under a random name', () => {
    expect(emailMediaPath('image/png', new Date('2026-12-03T00:00:00Z'), 'abc')).toBe(
      '2026-12/abc.png'
    );
  });
});

describe('the email background', () => {
  const content = (background: unknown) =>
    blockContentSchema.safeParse({ type: 'blocks', subject: 'Hi', background, blocks: [] });

  it('is a Pyre photo or an uploaded image address', () => {
    expect(content('clouds').success).toBe(true);
    expect(
      content('https://x.supabase.co/storage/v1/object/public/email-media/2026-12/a.jpg').success
    ).toBe(true);
  });

  it('refuses anything that could break out of the CSS around it', () => {
    expect(content('sunset').success).toBe(false);
    expect(content('javascript:alert(1)').success).toBe(false);
    expect(content('https://x.test/a.jpg) no-repeat; color: red').success).toBe(false);
    expect(content('https://x.test/"a.jpg').success).toBe(false);
    expect(content('https://x.test/{{firstName}}.jpg').success).toBe(false);
  });
});
