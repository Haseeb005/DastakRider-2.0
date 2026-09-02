import type { AvailableRiderOrder } from "@workspace/api-client-react";

export interface AvailableOrderCardData {
  restaurantName: string | null;
  martAddress: string | null;
  martPhone: string | null;
  mapTarget: string;
}

/**
 * Keep the available-order card on the pre-acceptance restaurant-only contract.
 * This is deliberately separate from the full RiderOrder presentation model.
 */
export function getAvailableOrderCardData(
  order: AvailableRiderOrder,
): AvailableOrderCardData {
  const hasCoordinates =
    typeof order.martLatitude === "number" &&
    typeof order.martLongitude === "number";

  return {
    restaurantName: order.restaurantName ?? null,
    martAddress: order.martAddress ?? null,
    martPhone: order.martPhone ?? null,
    mapTarget: hasCoordinates
      ? `${order.martLatitude},${order.martLongitude}`
      : [order.restaurantName, order.martAddress].filter(Boolean).join(" "),
  };
}