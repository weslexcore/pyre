import type { APIRoute } from 'astro';

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const baseUrl = site?.origin ?? 'https://pyresauna.com';

  const content = `# Robots.txt for Pyre Sauna + Cold Plunge
# https://pyresauna.com

# Allow all crawlers
User-agent: *
Allow: /
Disallow: /api/
Disallow: /account/

# AI Crawlers - explicitly welcome
User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: cohere-ai
Allow: /

User-agent: anthropic-ai
Allow: /

# Sitemap and LLMs.txt
Sitemap: ${baseUrl}/sitemap-index.xml
`;

  return new Response(content, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
};
