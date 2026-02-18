import type { APIRoute } from 'astro';

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const baseUrl = site?.origin ?? 'https://pyresauna.com';

  const content = `# Pyre Sauna + Cold Plunge

> Pyre is a modern communal bathhouse in Richmond, VA offering traditional Finnish saunas, cold plunge pools, and guided wellness experiences. We combine ancient sweat bathing traditions with modern community-focused wellness.

Pyre provides contrast therapy (sauna + cold plunge), guided sessions led by certified sauna masters, and special events including breathwork, sound baths, and group experiences. We focus on authentic human connection and science-backed wellness practices.

- Contact: hi@pyresauna.com
- Instagram: https://instagram.com/pyre_sauna
- Group bookings: groups@pyresauna.com

## Experiences

- [Free Flow Sessions](${baseUrl}/events): Move between saunas and cold plunges at your own pace
- [Guided Sessions](${baseUrl}/events): Curated experiences by certified sauna masters blending sauna, cold plunge, breathwork, and movement
- [Special Events](${baseUrl}/events): Sound baths, breathwork, drumming, guided meditations, and communal healing
- [Private Group Experiences](mailto:groups@pyresauna.com): Exclusive access for up to 25 guests for birthdays, corporate events, and celebrations

## Memberships

- Limited Plan ($99/month): 4 sauna and cold plunge sessions, credits rollover 1 month, 10% off extra sessions
- Unlimited Plan ($199/month): Unlimited access, free Pyre tote bag, 4 guest passes per month, 10% off extra guest sessions

## Facilities

- Traditional Finnish saunas (170-195 F)
- Cold plunge pools (39-50 F)
- Towels and amenities provided
- Bring: swimsuit, water bottle, optional robe/sandals

## Blog

- [The Science-Backed Health Benefits of Regular Sauna Use](${baseUrl}/blog/sauna-health-benefits): How regular sauna sessions improve cardiovascular function, mental wellness, and muscle recovery
- [The Science Behind Cold Plunging](${baseUrl}/blog/cold-plunge-benefits): Health benefits of cold water immersion and best practices
- [The Loneliness Epidemic: How Social Sauna Builds Connection](${baseUrl}/blog/social-sauna-combating-loneliness): How communal sauna bathing combats isolation and builds community
- [Activating the Vagus Nerve](${baseUrl}/blog/vagus-nerve-wellness): How sauna, cold plunge, and breathwork enhance well-being through vagus nerve stimulation
- [Ancient Wisdom, Modern Wellness](${baseUrl}/blog/history-of-sweat-bathing): The global history of sweat bathing traditions
- [Our Mission, Vision, and Values](${baseUrl}/blog/our-mission-vision-values): The guiding principles behind Pyre

## FAQ

- What should I bring?: Swimsuit, water bottle, optional robe/sandals. Towels and amenities provided.
- How hot does the sauna get?: 170-195 F (traditional Finnish sauna temperatures).
- How cold is the cold plunge?: 39-50 F. Start with shorter immersions and increase gradually.
- Is contrast therapy safe?: Safe for healthy adults. Consult a doctor if you have cardiovascular conditions, high blood pressure, or are pregnant.
- Recommended session protocol: 10-20 min sauna, 1-3 min cold plunge, repeat 2-4 rounds.
- Do I need to book?: Yes, booking in advance recommended. Walk-ins welcome based on availability.

## Legal

- [Privacy Policy](${baseUrl}/privacy-policy)
- [Cookie Policy](${baseUrl}/cookie-policy)
- [Terms of Service](${baseUrl}/terms-of-service)

## Optional

- [Full content for LLMs](${baseUrl}/llms-full.txt): Comprehensive site content in a single file
- [Sitemap](${baseUrl}/sitemap-index.xml): XML sitemap for all pages
`;

  return new Response(content, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
};
