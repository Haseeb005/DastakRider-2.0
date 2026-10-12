import { ordersCol } from "./mongo";

export const IDLE_RIDER_PRIORITY_MS = 30_000;

export type RiderCandidate = {
  _id: unknown;
  type?: unknown;
  isOnline?: unknown;
  deleted?: unknown;
  city?: unknown;
  riderZones?: unknown;
  maxOrderLimit?: unknown;
  playerId?: unknown;
};

export type AvailableOrderForDistribution = {
  city?: unknown;
  zone?: unknown;
  riderOfferStartedAt?: unknown;
};

export type RiderOfferAudience = {
  eligibleRiders: RiderCandidate[];
  idleRiders: RiderCandidate[];
  priorityEndsAt: number;
  idlePriorityActive: boolean;
};

export async function getActiveOrderCounts(
  riders: RiderCandidate[],
  session?: any,
): Promise<Map<string, number>> {
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
        { $group: { _id: "$riderId", count: { $sum: 1 } } },
      ],
      session ? { session } : {},
    )
    .toArray();
  return new Map(rows.map((row: any) => [String(row._id), Number(row.count) || 0]));
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

function activeCountFor(rider: RiderCandidate, activeCounts: Map<string, number>) {
  return activeCounts.get(String(rider._id)) ?? 0;
}

export function getRiderOfferAudience(
  order: AvailableOrderForDistribution,
  riders: RiderCandidate[],
  activeCounts: Map<string, number>,
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

    const limit = Number(rider.maxOrderLimit) || 0;
    return limit <= 0 || activeCountFor(rider, activeCounts) < limit;
  });

  const idleRiders = eligibleRiders.filter(
    (rider) => activeCountFor(rider, activeCounts) === 0,
  );
  const start = new Date(
    order.riderOfferStartedAt as string | number | Date,
  ).getTime();
  const priorityEndsAt = Number.isFinite(start)
    ? start + IDLE_RIDER_PRIORITY_MS
    : now + IDLE_RIDER_PRIORITY_MS;

  return {
    eligibleRiders,
    idleRiders,
    priorityEndsAt,
    idlePriorityActive: idleRiders.length > 0 && now < priorityEndsAt,
  };
}

export function riderCanSeeAvailableOrder(
  riderId: string,
  audience: RiderOfferAudience,
): boolean {
  const visibleRiders = audience.idlePriorityActive
    ? audience.idleRiders
    : audience.eligibleRiders;
  return visibleRiders.some((rider) => String(rider._id) === riderId);
}
