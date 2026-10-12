type OrderProduct = {
  actualPrice?: unknown;
  count?: unknown;
};

type OrderForRestaurantCash = {
  billingMode?: unknown;
  shopType?: unknown;
  vatAmount?: unknown;
  products?: unknown;
};

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function calculatePrepaidRestaurantCashAmount(
  order: OrderForRestaurantCash,
): number | null {
  if (
    String(order.billingMode ?? "").trim().toLowerCase() !== "prepaid" ||
    String(order.shopType ?? "").trim().toLowerCase() !== "restaurant"
  ) {
    return null;
  }

  const products = Array.isArray(order.products)
    ? (order.products as OrderProduct[])
    : [];
  const actualPriceTotal = products.reduce((total, product) => {
    const actualPrice = finiteNumber(product?.actualPrice);
    if (actualPrice <= 0) return total;

    const rawCount = finiteNumber(product?.count);
    const count = rawCount > 0 ? rawCount : 1;
    return total + actualPrice * count;
  }, 0);

  if (actualPriceTotal <= 0) return null;

  const vatAmount = Math.max(finiteNumber(order.vatAmount), 0);
  return Math.round((actualPriceTotal + vatAmount) * 100) / 100;
}
