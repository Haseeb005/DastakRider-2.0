export const FAST_DELIVERY_WINDOW_MS = 20 * 60 * 1000;
const FAST_DELIVERY_BONUS_RETRY_DELAYS_MS = [100, 250] as const;

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Retry wallet persistence after brief storage failures. The caller must use an
 * idempotent write because a network error can happen after MongoDB committed it.
 */
export async function retryFastDeliveryBonusWrite<T>(
  write: () => Promise<T>,
  wait: (delayMs: number) => Promise<void> = waitForRetry,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await write();
    } catch (error) {
      const delayMs = FAST_DELIVERY_BONUS_RETRY_DELAYS_MS[attempt];
      if (delayMs === undefined) throw error;
      await wait(delayMs);
    }
  }
}

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
