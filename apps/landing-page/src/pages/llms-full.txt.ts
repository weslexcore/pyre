import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';
import about from '@/lib/about';
import benefits from '@/lib/experiences';
import faqs from '@/lib/faqs';
import groupBooking from '@/lib/group-booking';
import membership from '@/lib/membership';
import privateRentals from '@/lib/private-rentals';
import shop from '@/lib/shop';

export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  const baseUrl = site?.origin ?? 'https://pyresauna.com';

  // Fetch all published blog posts
  const allPosts = await getCollection('blog', ({ data }) => !data.draft);
  const sortedPosts = allPosts.sort(
    (a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime()
  );

  const blogSection = sortedPosts
    .map(
      (post) =>
        `### ${post.data.title}\n\n- **URL**: ${baseUrl}/blog/${post.id}\n- **Author**: ${post.data.author}\n- **Date**: ${post.data.date.toISOString().split('T')[0]}\n- **Tags**: ${post.data.tags.join(', ')}\n\n${post.data.description}`
    )
    .join('\n\n');

  const faqSection = faqs.items
    .map((faq) => `**Q: ${faq.question}**\nA: ${faq.answer}`)
    .join('\n\n');

  const membershipSection = membership.tiers
    .map(
      (tier) =>
        `### ${tier.name} - $${tier.price}${tier.period}\n\n${tier.description}\n\n${tier.features.map((f) => `- ${f.text}`).join('\n')}`
    )
    .join('\n\n');

  const experiencesSection = benefits.items
    .map((item) => `### ${item.title}\n\n${item.description}`)
    .join('\n\n');

  const content = `# Pyre Sauna + Cold Plunge

> Pyre is a modern communal bathhouse in Richmond, VA offering traditional Finnish saunas, cold plunge pools, and guided wellness experiences. We combine ancient sweat bathing traditions with modern community-focused wellness to help people release stress, reconnect, and feel more human together.

## About

${about.title}

${about.body.join('\n\n')}

## Experiences

${benefits.subtitle}

${experiencesSection}

${benefits.closing}

## Sessions and Booking

Pyre offers sauna and cold plunge sessions that can be booked through our events page at ${baseUrl}/events. We recommend booking in advance to guarantee your preferred time slot. Walk-ins are welcome based on availability.

### What to Expect

Our facilities include traditional Finnish saunas reaching 170-195 F and cold plunge pools maintained at 39-50 F. We recommend the following protocol for optimal benefits:

1. Sauna session: 10-20 minutes
2. Cold plunge: 1-3 minutes
3. Rest period
4. Repeat 2-4 rounds

### What to Bring

Bring a swimsuit, a water bottle, and an optional robe or sandals. We provide towels and all the amenities you need for your session.

## Memberships

${membership.subtitle}

${membershipSection}

Note: ${membership.note}

## Private Group Experiences

${groupBooking.subtitle}

${groupBooking.description.join('\n\n')}

Capacity: ${groupBooking.capacity.label}

### Available For

${(groupBooking.occasions ?? []).map((o) => `- ${o.label}`).join('\n')}

Contact: groups@pyresauna.com

## Private Rentals

${privateRentals.subtitle ?? ''}

${privateRentals.unitSummary}

${privateRentals.description.join('\n\n')}

**${privateRentals.periodLabel}**

${privateRentals.tiers
  .map(
    (t) =>
      `- **${t.name}**: $${t.price} base; +$${t.extraDayPrice} per additional day — ${t.features.join('; ')}`
  )
  .join('\n')}

${privateRentals.logistics.join('\n\n')}

${privateRentals.addonSummary}

Private rental inquiries: rentals@pyresauna.com

## Shop

Browse Pyre merchandise and essentials at ${baseUrl}/shop

${shop.products
  .map(
    (p) =>
      `### ${p.name} — $${p.price}\n\n${p.description}\n\n- **Category**: ${p.category}\n- **Purchase**: ${p.purchaseUrl}${p.variants ? `\n- **Sizes**: ${p.variants.map((v) => v.name).join(', ')}` : ''}`
  )
  .join('\n\n')}

## Blog

${blogSection}

## Frequently Asked Questions

${faqSection}

## Safety Information

Contrast therapy (alternating sauna and cold plunge) is safe for healthy adults. However, if you have cardiovascular conditions, high blood pressure, or are pregnant, please consult your doctor before participating. Stay hydrated and listen to your body at all times.

Our sauna masters hold certifications from the Deutsche Sauna-Akademie and Sherpa Breath and Cold.

## Contact

- **Email**: hi@pyresauna.com
- **Group bookings**: groups@pyresauna.com
- **Sauna rentals**: rentals@pyresauna.com
- **Instagram**: https://instagram.com/pyre_sauna
- **Website**: ${baseUrl}

## Legal

- [Privacy Policy](${baseUrl}/privacy-policy)
- [Cookie Policy](${baseUrl}/cookie-policy)
- [Terms of Service](${baseUrl}/terms-of-service)
`;

  return new Response(content, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
};
