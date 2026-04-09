import type { MomenceProduct, StockInfo, StockMap } from './types';

const MOMENCE_API_BASE = 'https://api.momence.com/api/v1';

const SIZE_ORDER: Record<string, number> = {
  XS: 0,
  S: 1,
  M: 2,
  L: 3,
  XL: 4,
  '2XL': 5,
  '3XL': 6,
};

function sortVariantsBySize<T extends { name: string }>(variants: T[]): T[] {
  return [...variants].sort((a, b) => {
    const aOrder = SIZE_ORDER[a.name.toUpperCase()] ?? 99;
    const bOrder = SIZE_ORDER[b.name.toUpperCase()] ?? 99;
    return aOrder - bOrder;
  });
}

export function isOutOfStock(leftInStock: number | null): boolean {
  return leftInStock === null || leftInStock <= 0;
}

export async function fetchMomenceProducts(): Promise<MomenceProduct[]> {
  const hostId = import.meta.env.MOMENCE_HOST_ID;
  const apiToken = import.meta.env.MOMENCE_API_TOKEN;

  if (!hostId || !apiToken) {
    console.warn('[Shop] Missing Momence credentials');
    return [];
  }

  try {
    const res = await fetch(`${MOMENCE_API_BASE}/Products?hostId=${hostId}&token=${apiToken}`, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      console.error(`[Shop] Momence returned ${res.status}`);
      return [];
    }

    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('[Shop] Failed to fetch products:', err);
    return [];
  }
}

/**
 * Build a stock map keyed by Momence product ID.
 * Consumed by the /api/shop-stock endpoint and sent to the client
 * for hydrating the statically rendered shop page.
 */
export function buildStockMap(momenceProducts: MomenceProduct[]): StockMap {
  const map: StockMap = {};

  for (const product of momenceProducts) {
    if (product.isDeleted) continue;

    const variants = sortVariantsBySize(
      product.variants
        .filter((v) => !v.isDeleted)
        .map((v) => ({
          name: v.name,
          price: v.price !== product.price ? v.price : undefined,
          soldOut: isOutOfStock(v.leftInStock),
        }))
    );

    const allVariantsSoldOut = variants.length > 0 && variants.every((v) => v.soldOut);
    const soldOut = isOutOfStock(product.leftInStock) || allVariantsSoldOut;

    const entry: StockInfo = {
      price: product.price,
      purchaseUrl: product.link,
      soldOut,
      variants,
    };

    map[String(product.id)] = entry;
  }

  return map;
}
