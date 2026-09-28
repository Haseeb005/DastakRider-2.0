import type { AvailableRiderOrder } from "./generated/api.schemas";

/**
 * A rejected offer must never be retried with the token from the stale card.
 * Only a newly fetched, still-live offer for the same order can be submitted.
 * The server remains responsible for verifying the signed rider/order binding.
 */
export function findRenewedOffer(
  rejected: AvailableRiderOrder,
  refreshed: AvailableRiderOrder[] | undefined,
  now = Date.now(),
): AvailableRiderOrder | null {
  const current = refreshed?.find((order) => order.id === rejected.id);
  if (
    !current?.offerToken ||
    current.offerToken === rejected.offerToken ||
    !Number.isFinite(Date.parse(current.offerExpiresAt)) ||
    Date.parse(current.offerExpiresAt) <= now
  ) {
    return null;
  }
  return current;
}