import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';
import experiences from '@/lib/experiences';
import faqs from '@/lib/faqs';
import membership from '@/lib/membership';

export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
	const baseUrl = site?.origin ?? 'https://pyresauna.com';

	// Fetch all published blog posts
	const allPosts = await getCollection('blog', ({ data }) => !data.draft);
	const sortedPosts = allPosts.sort(
		(a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime(),
	);

	const experiencesList = experiences.items
		.map((item) => `- [${item.title}](${baseUrl}/events): ${item.description}`)
		.join('\n');

	const membershipList = membership.tiers
		.map(
			(tier) =>
				`- ${tier.name} ($${tier.price}${tier.period}): ${tier.features.map((f) => f.text).join(', ')}`,
		)
		.join('\n');

	const blogList = sortedPosts
		.map((post) => `- [${post.data.title}](${baseUrl}/blog/${post.slug}): ${post.data.description}`)
		.join('\n');

	const faqList = faqs.items
		.map((faq) => `- ${faq.question}: ${faq.answer}`)
		.join('\n');

	const content = `# Pyre Sauna + Cold Plunge

> Pyre is a modern communal bathhouse in Richmond, VA offering traditional Finnish saunas, cold plunge pools, and guided wellness experiences. We combine ancient sweat bathing traditions with modern community-focused wellness.

Pyre provides contrast therapy (sauna + cold plunge), guided sessions led by certified sauna masters, and special events including breathwork, sound baths, and group experiences. We focus on authentic human connection and science-backed wellness practices.

- Contact: hi@pyresauna.com
- Instagram: https://instagram.com/pyre_sauna
- Group bookings: groups@pyresauna.com

## Experiences

${experiencesList}
- [Private Group Experiences](mailto:groups@pyresauna.com): Exclusive access for up to 25 guests for birthdays, corporate events, and celebrations

## Memberships

${membershipList}

## Facilities

- Traditional Finnish saunas (170-195 F)
- Cold plunge pools (39-50 F)
- Towels and amenities provided
- Bring: swimsuit, water bottle, optional robe/sandals

## Blog

${blogList}

## FAQ

${faqList}

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
