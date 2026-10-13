/**
 * Recognize cash deliveries made in the current collection window.
 * Legacy clients store only a time-of-day delivery marker. For those records,
 * creation within this window plus a nonempty delivery marker is sufficient:
 * delivery cannot have happened before the order was created.
 * Never rely on the shared status, which external systems can overwrite.
 */
export function currentWindowCodDeliveryFilter(riderId: string, windowStart: Date) {
  return {
    riderId,
    $and: [
      {
        $or: [
          { paymentType: { $in: ["COD", "Cash", "cash", "cod"] } },
          {
            paymentType: { $in: [null, ""] },
            paymentMethod: { $in: ["COD", "Cash", "cash", "cod"] },
          },
        ],
      },
      {
        $or: [
          { riderDeliveredAt: { $gte: windowStart } },
          {
            riderDeliveredAt: null,
            createdAt: { $gte: windowStart },
            timeWhenDelivered: { $type: "string", $ne: "" },
          },
        ],
      },
    ],
  };
}
