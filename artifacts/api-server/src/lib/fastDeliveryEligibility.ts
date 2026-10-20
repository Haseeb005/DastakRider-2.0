export const FAST_DELIVERY_WINDOW_MS = 20 * 60 * 1000;

/** Returns the accepted-to-delivered duration when the order qualifies. */
export function fastDeliveryDurationMinutes(
  acceptedTime: unknown,
  deliveredAt: Date,
): number | null {
  if (acceptedTime === null || acceptedTime === undefined || acceptedTime === "") {
    return null;
  }
  const acceptedAt = new Date(acceptedTime as string | number | Date);
  const acceptedAtMs = acceptedAt.getTime();
  const deliveredAtMs = deliveredAt.getTime();
  if (!Number.isFinite(acceptedAtMs) || !Number.isFinite(deliveredAtMs)) {
    return null;
  }

  const durationMs = deliveredAtMs - acceptedAtMs;
  if (durationMs < 0 || durationMs > FAST_DELIVERY_WINDOW_MS) return null;
  return durationMs / 60_000;
}
