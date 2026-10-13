import { ordersCol } from "./mongo";

export const IDLE_RIDER_PRIORITY_MS = 30_000;

// Explicit rider-account exceptions requested by operations. Keep all other
// city/zone, online, order-availability, and cash rules in force.
const ORDER_LIMIT_EXEMPT_RIDER_IDS = new Set([
  "63d903994c2d23004da46c15",
  "63d9097c4c2d23004da46c18",
]);

export type RiderCandidate = {
  _id: unknown;
  type?: unknown;
  isOnline?: unknown;
  deleted?: unknown;
  city?: unknown;
  riderZones?: unknown;
  playerId?: unknown;
};

export type RiderLiveOrderCounts = {
  activeCount: number;
  acceptedCount: number;
  pickedUpCount: number;
};

export type AvailableOrderForDistribution = {
  city?: unknown;
  zone?: unknown;
  riderOfferStartedAt?: unknown;
};

export type RiderOfferAudience = {
  /** Riders allowed to accept after the 30-second idle-rider window. */
  eligibleRiders: RiderCandidate[];
  idleRiders: RiderCandidate[];
  priorityEndsAt: number;
  priorityWindowOpen: boolean;
  idlePriorityActive: boolean;
};

export function isOrderLimitExemptRider(riderId: string): boolean {
  return ORDER_LIMIT_EXEMPT_RIDER_IDS.has(riderId);
}

export function canAcceptAnotherLiveOrder(
  riderId: string,
  counts: RiderLiveOrderCounts,
): boolean {
  return (
    isOrderLimitExemptRider(riderId) ||
    (counts.activeCount < 2 && counts.acceptedCount === 0)
  );
}

export async function getRiderLiveOrderCounts(
  riders: RiderCandidate[],
  session?: any,
): Promise<Map<string, RiderLiveOrderCounts>> {
  const riderIds = riders.map((rider) => String(rider._id));
  if (riderIds.length === 0) return new Map();

  const rows = await ordersCol()
    .aggregate(
      [
        {
          $match: {
            riderId: { $in: riderIds },
            status: { $in: ["Rider Accepted", "Rider Picked Up"] },
          },
        },
        { $group: { _id: { riderId: "$riderId", status: "$status" }, count: { $sum: 1 } } },
      ],
      session ? { session } : {},
    )
    .toArray();
  const counts = new Map<string, RiderLiveOrderCounts>();
  for (const row of rows as any[]) {
    const riderId = String(row._id.riderId);
    const current = counts.get(riderId) ?? {
      activeCount: 0,
      acceptedCount: 0,
      pickedUpCount: 0,
    };
    const count = Number(row.count) || 0;
    current.activeCount += count;
    if (row._id.status === "Rider Accepted") current.acceptedCount += count;
    if (row._id.status === "Rider Picked Up") current.pickedUpCount += count;
    counts.set(riderId, current);
  }
  return counts;
}

export async function ensureRiderOfferStartedAt(order: {
  _id: unknown;
  status?: unknown;
  riderOfferStartedAt?: unknown;
}): Promise<Date> {
  const existing = new Date(
    order.riderOfferStartedAt as string | number | Date,
  );
  if (Number.isFinite(existing.getTime())) return existing;

  const startedAt = new Date();
  await ordersCol().updateOne(
    {
      _id: order._id as any,
      status: "Admin Accepted",
      $or: [
        { riderOfferStartedAt: { $exists: false } },
        { riderOfferStartedAt: null },
      ],
    },
    { $set: { riderOfferStartedAt: startedAt } },
  );

  const latest = await ordersCol().findOne(
    { _id: order._id as any },
    { projection: { riderOfferStartedAt: 1 } },
  );
  const persisted = new Date(
    latest?.riderOfferStartedAt as string | number | Date,
  );
  return Number.isFinite(persisted.getTime()) ? persisted : startedAt;
}

function liveCountsFor(
  rider: RiderCandidate,
  liveCounts: Map<string, RiderLiveOrderCounts>,
): RiderLiveOrderCounts {
  return liveCounts.get(String(rider._id)) ?? {
    activeCount: 0,
    acceptedCount: 0,
    pickedUpCount: 0,
  };
}

export function getRiderOfferAudience(
  order: AvailableOrderForDistribution,
  riders: RiderCandidate[],
  liveCounts: Map<string, RiderLiveOrderCounts>,
  now = Date.now(),
): RiderOfferAudience {
  const orderCity = String(order.city ?? "");
  const orderZone = String(order.zone ?? "");
  const eligibleRiders = riders.filter((rider) => {
    if (rider.type !== "rider" || rider.isOnline !== true || rider.deleted === true) {
      return false;
    }
    if (rider.city && rider.city !== orderCity) return false;
    const zones = Array.isArray(rider.riderZones)
      ? rider.riderZones.filter(Boolean).map(String)
      : [];
    if (zones.length > 0 && !zones.includes(orderZone)) return false;
    return true;
  });

  const idleRiders = eligibleRiders.filter(
    (rider) => liveCountsFor(rider, liveCounts).activeCount === 0,
  );
  const pickedUpRiders = eligibleRiders.filter((rider) => {
    const counts = liveCountsFor(rider, liveCounts);
    return (
      !isOrderLimitExemptRider(String(rider._id)) &&
      counts.activeCount > 0 &&
      canAcceptAnotherLiveOrder(String(rider._id), counts) &&
      counts.pickedUpCount > 0
    );
  });
  const unlimitedBusyRiders = eligibleRiders.filter(
    (rider) =>
      isOrderLimitExemptRider(String(rider._id)) &&
      liveCountsFor(rider, liveCounts).activeCount > 0,
  );
  const start = new Date(
    order.riderOfferStartedAt as string | number | Date,
  ).getTime();
  const priorityEndsAt = Number.isFinite(start)
    ? start + IDLE_RIDER_PRIORITY_MS
    : now + IDLE_RIDER_PRIORITY_MS;

  return {
    eligibleRiders: [...idleRiders, ...pickedUpRiders, ...unlimitedBusyRiders],
    idleRiders,
    priorityEndsAt,
    priorityWindowOpen: now < priorityEndsAt,
    idlePriorityActive: now < priorityEndsAt,
  };
}

export function riderCanSeeAvailableOrder(
  riderId: string,
  audience: RiderOfferAudience,
): boolean {
  const visibleRiders = audience.priorityWindowOpen
    ? audience.idleRiders
    : audience.eligibleRiders;
  return visibleRiders.some((rider) => String(rider._id) === riderId);
}
