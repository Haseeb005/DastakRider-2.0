export const MAX_GPS_FIX_AGE_MS = 15_000;

export function selectActiveDeliveryOrderIds(orders) {
  const ids = new Set();
  for (const order of orders ?? []) {
    if (order?.status !== "Rider Picked Up") continue;
    const candidate = order._id ?? order.id;
    if (typeof candidate === "string" && /^[a-f\d]{24}$/i.test(candidate)) {
      ids.add(candidate.toLowerCase());
    }
  }
  return [...ids].sort();
}

export function capturedAtForFreshFix(timestamp, now = Date.now()) {
  if (
    typeof timestamp !== "number" ||
    !Number.isFinite(timestamp) ||
    timestamp > now ||
    now - timestamp > MAX_GPS_FIX_AGE_MS
  ) return null;
  return new Date(timestamp).toISOString();
}
