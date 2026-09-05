import { render } from '@react-email/components';
import { describe, expect, it } from 'vitest';
import { guestItemClause } from '@/lib/lost-found/types';
import { LostFoundFound } from './LostFoundFound';
import type { LostFoundFoundProps } from '../types';

// The log form shows staff a live preview of the sentence the guest will read,
// composed with guestItemClause. That promise is only worth anything if the
// email composes it the same way — and it once didn't: the template carried its
// own copy of the wording, so editing the helper changed the preview and left
// the email saying something else. These render the real template and check the
// two agree.

const base: LostFoundFoundProps = {
  firstName: '',
  reference: 'LF-2026-0007',
  itemLabel: 'Black water bottle',
  foundDateLabel: 'Tuesday, September 2',
  donateDateLabel: 'October 2',
  donationPartner: 'Furbish Thrift',
};

const renderText = async (props: Partial<LostFoundFoundProps>): Promise<string> =>
  (await render(<LostFoundFound {...base} {...props} />, { plainText: true }))
    .replace(/\s+/g, ' ')
    .trim();

describe('LostFoundFound', () => {
  it('opens with exactly the clause the log form previewed', async () => {
    const body = await renderText({});
    const clause = guestItemClause(base.itemLabel);
    const capitalised = clause.charAt(0).toUpperCase() + clause.slice(1);
    expect(body).toContain(`${capitalised} on ${base.foundDateLabel}`);
  });

  it('addresses someone by name without capitalising mid-sentence', async () => {
    const body = await renderText({ firstName: 'Alex' });
    expect(body).toContain('Alex — we found a black water bottle on');
  });

  it('tells them the date it goes to the donation partner', async () => {
    const body = await renderText({});
    expect(body).toContain('Furbish Thrift');
    expect(body).toContain('October 2');
  });

  it('keeps the distinguishing description out of the guest email', async () => {
    // description is not a prop at all — this asserts the shape stays that way,
    // because "silver ring, engraved M.K." in a blast is how the wrong person
    // claims it.
    expect(Object.keys(base)).not.toContain('description');
  });

  it('offers the claim button only when a signed link exists', async () => {
    expect(await renderText({})).not.toContain('This is mine');
    expect(await renderText({ claimUrl: 'https://example.com/claim?token=a.b' })).toContain(
      'This is mine'
    );
  });
});
