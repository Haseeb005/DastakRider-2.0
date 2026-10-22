export interface RiderPushCandidate {
  _id: unknown;
  playerId?: unknown;
  isOnline?: unknown;
  deleted?: unknown;
  type?: unknown;
}

export interface RiderPushTargets {
  subscriptionIds: string[];
  riderIds: string[];
}

/**
 * Keep push targets only when their rider account is explicitly online.
 * This is applied immediately before the OneSignal request so stale target
 * lists cannot notify riders who have since gone offline.
 */
export function filterOnlineRiderPushTargets(
  subscriptionIds: string[],
  riderIds: string[],
  riders: RiderPushCandidate[],
): RiderPushTargets {
  const onlineRiders = riders.filter(
    (rider) =>
      rider.type === "rider" &&
      rider.isOnline === true &&
      rider.deleted !== true,
  );
  const onlineSubscriptionIds = new Set(
    onlineRiders
      .map((rider) =>
        typeof rider.playerId === "string" ? rider.playerId.trim() : "",
      )
      .filter(Boolean),
  );
  const onlineRiderIds = new Set(
    onlineRiders.map((rider) => String(rider._id)),
  );

  return {
    subscriptionIds: [...new Set(subscriptionIds.map((id) => id.trim()))]
      .filter((id) => id && onlineSubscriptionIds.has(id)),
    riderIds: [...new Set(riderIds.map((id) => id.trim()))]
      .filter((id) => id && onlineRiderIds.has(id)),
  };
}
