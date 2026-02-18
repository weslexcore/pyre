import type { APIRoute } from 'astro';

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
	const siteUrl = site?.toString().replace(/\/$/, '') ?? 'https://pyresauna.com';

	const robotsTxt = [
		'User-agent: *',
		'Allow: /',
		'',
		'# Block API and account routes',
		'Disallow: /api/',
		'Disallow: /account/',
		'',
		`Sitemap: ${siteUrl}/sitemap-index.xml`,
	].join('\n');

	return new Response(robotsTxt, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
};
