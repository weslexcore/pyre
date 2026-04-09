import type { MomenceProduct, ShopProduct, ShopVariant } from './types';

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

function sortVariants(variants: ShopVariant[]): ShopVariant[] {
  return [...variants].sort((a, b) => {
    const aOrder = SIZE_ORDER[a.name.toUpperCase()] ?? 99;
    const bOrder = SIZE_ORDER[b.name.toUpperCase()] ?? 99;
    return aOrder - bOrder;
  });
}

/**
 * Fetch products from the Momence v1 API.
 */
async function fetchMomenceProducts(): Promise<MomenceProduct[]> {
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
    // console.log(data);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('[Shop] Failed to fetch products:', err);
    return [];
  }
}
 
function isOutOfStock(leftInStock: number | null): boolean {
  return leftInStock === null || leftInStock <= 0;
}

/**
 * Merge live Momence data onto the static product catalog.
 *
 * Static config provides: images, descriptions, categories.
 * Momence provides: price, variants, stock levels, purchase links.
 *
 * Products without a `momenceId` are passed through unchanged (useful for
 * items not yet in Momence).
 */
export async function getShopProductsWithStock(
  staticProducts: ShopProduct[]
): Promise<ShopProduct[]> {
  const momenceProducts = await fetchMomenceProducts();

  if (momenceProducts.length === 0) {
    return staticProducts;
  }

  const momenceById = new Map(momenceProducts.map((p) => [p.id, p]));

  return staticProducts
    .map((product) => {
      if (!product.momenceId) return product;

      const live = momenceById.get(product.momenceId);
      if (!live) return product;

      if (live.isDeleted) return null;

      const liveVariants =
        live.variants.length > 0
          ? sortVariants(
              live.variants
                .filter((v) => !v.isDeleted)
                .map((v) => ({
                  name: v.name,
                  price: v.price !== live.price ? v.price : undefined,
                  soldOut: isOutOfStock(v.leftInStock),
                }))
            )
          : product.variants;

      const allVariantsSoldOut =
        liveVariants && liveVariants.length > 0 && liveVariants.every((v) => v.soldOut);

      const productSoldOut = isOutOfStock(live.leftInStock) || allVariantsSoldOut;

      return {
        ...product,
        price: live.price,
        purchaseUrl: live.link,
        variants: liveVariants,
        soldOut: productSoldOut || undefined,
      } satisfies ShopProduct;
    })
    .filter((p): p is ShopProduct => p !== null)
    .sort((a, b) => Number(!!a.soldOut) - Number(!!b.soldOut));
}
