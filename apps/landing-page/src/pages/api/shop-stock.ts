import type { APIRoute } from 'astro';
import { buildStockMap, fetchMomenceProducts } from '@/lib/momence-products';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const products = await fetchMomenceProducts();
    const stockMap = buildStockMap(products);

    return new Response(JSON.stringify(stockMap), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch (error) {
    console.error('[Shop Stock API] Error:', error);

    return new Response(JSON.stringify({}), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }
};
