/**
 * orderPushWatcher
 *
 * Watches the local MongoDB change-event source for `orders` collection
 * changes. When an order transitions to "Admin Accepted" (unassigned), it
 * finds all online, eligible riders (matching city + zones) and sends each of
 * them a OneSignal push notification so they can tap to accept it.
 *
 * Deduplication: each orderId is pushed at most once per "Admin Accepted" window.
 * The seen-set is cleared when the order gets a riderId (accepted) or on restart.
 */

import { ObjectId } from "mongodb";

import { logger } from "./logger";
import {
  ordersCol,
  riderOrderPushDeliveriesCol,
  subscribeToLiveChanges,
  usersCol,
} from "./mongo";
import { sendNewOrderPush } from "./onesignal";
import {
  claimRiderOrderPushes,
  finishRiderOrderPushClaims,
} from "./riderOrderPushDedupe";
import {
  ensureRiderOfferStartedAt,
  getRiderLiveOrderCounts,
  getRiderOfferAudience,
} from "./riderOrderDistribution";

/** Deduplicate each phase while allowing the 30-second broadening push. */
const priorityPushedOrders = new Set<string>();
const broadPushedOrders = new Set<string>();
const priorityRecipients = new Map<string, Set<string>>();
const broadPushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const processingOrders = new Set<string>();

async function handleOrderChange(rawId: string): Promise<void> {
  if (processingOrders.has(rawId)) return;
  processingOrders.add(rawId);

  try {
    // Fetch the order document.
    let order: Record<string, any> | null = null;
    try {
      order = await ordersCol().findOne({ _id: new ObjectId(rawId) } as any);
    } catch {
      order = null;
    }

    if (!order) return;

    // Leaving the availability window resets deduplication so a later re-open
    // can notify riders again.
    const hasRider = order.riderId && order.riderId !== "";
    if (order.status !== "Admin Accepted" || hasRider) {
      priorityPushedOrders.delete(rawId);
      broadPushedOrders.delete(rawId);
      priorityRecipients.delete(rawId);
      const timer = broadPushTimers.get(rawId);
      if (timer) clearTimeout(timer);
      broadPushTimers.delete(rawId);
      return;
    }

    if (broadPushedOrders.has(rawId)) return;
    const city: string = order.city ?? "";
    const zone: string = order.zone ?? "";
    const orderId = String(order._id);
    const restaurantName: string | undefined = order.martName || undefined;
    const martAddress: string | undefined = order.martAddress || undefined;

    const riders = await usersCol()
      .find(
        { type: "rider", isOnline: true, deleted: { $ne: true } },
        {
          projection: {
            _id: 1, type: 1, isOnline: 1, deleted: 1, city: 1,
            riderZones: 1, playerId: 1,
          },
        },
      )
      .toArray();

    const counts = await getRiderLiveOrderCounts(riders);
    const offerStartedAt = await ensureRiderOfferStartedAt(order as any);
    const audience = getRiderOfferAudience(
      { ...order, riderOfferStartedAt: offerStartedAt },
      riders,
      counts,
    );
    const priorityPhase = audience.idlePriorityActive;
    let recipients = priorityPhase ? audience.idleRiders : audience.eligibleRiders;
    if (!priorityPhase && priorityRecipients.has(rawId)) {
      const alreadyNotified = priorityRecipients.get(rawId)!;
      recipients = recipients.filter(
        (r: any) => !alreadyNotified.has(String(r._id)),
      );
    }

    if (priorityPhase && priorityPushedOrders.has(rawId)) {
      scheduleBroadPush(rawId, audience.priorityEndsAt - Date.now());
      return;
    }
    if (!priorityPhase && broadPushedOrders.has(rawId)) return;
    if (!priorityPhase && recipients.length === 0) {
      broadPushedOrders.add(rawId);
      return;
    }
    if (priorityPhase) {
      scheduleBroadPush(rawId, audience.priorityEndsAt - Date.now());
    }

    if (recipients.length === 0) {
      logger.info({ orderId, city, zone }, "orderPushWatcher: no online riders to notify");
    } else {
      const claims = await claimRiderOrderPushes(
        riderOrderPushDeliveriesCol(),
        orderId,
        offerStartedAt,
        recipients,
      );
      if (claims.length === 0) return;

      // OneSignal does not allow subscription IDs and external IDs in the same
      // request. Keep the two disjoint target groups in separate messages.
      const groups = [
        claims.filter((claim) => claim.playerId),
        claims.filter((claim) => !claim.playerId),
      ].filter((group) => group.length > 0);
      const results = await Promise.all(
        groups.map(async (group) => {
          let accepted = false;
          try {
            accepted = await sendNewOrderPush({
              playerIds: group.flatMap((claim) =>
                claim.playerId ? [claim.playerId] : [],
              ),
              riderIds: group.flatMap((claim) =>
                claim.playerId ? [] : [claim.riderId],
              ),
              orderId,
              restaurantName,
              martAddress,
            });
          } finally {
            await finishRiderOrderPushClaims(
              riderOrderPushDeliveriesCol(),
              group,
              accepted,
            );
          }
          return { accepted, riderIds: group.map((claim) => claim.riderId) };
        }),
      );
      const acceptedRiderIds = results
        .filter((result) => result.accepted)
        .flatMap((result) => result.riderIds);
      const allAccepted = results.every((result) => result.accepted);

      if (priorityPhase && acceptedRiderIds.length > 0) {
        priorityRecipients.set(
          rawId,
          new Set([
            ...(priorityRecipients.get(rawId) ?? []),
            ...acceptedRiderIds,
          ]),
        );
      }
      if (allAccepted) {
        if (priorityPhase) {
          priorityPushedOrders.add(rawId);
        } else {
          broadPushedOrders.add(rawId);
        }
      }
      logger.info(
        {
          orderId,
          phase: priorityPhase ? "idle-priority" : "broad",
          withPlayerId: claims.filter((claim) => claim.playerId).length,
          withExternalId: claims.filter((claim) => !claim.playerId).length,
          accepted: acceptedRiderIds.length,
          city,
          zone,
        },
        "orderPushWatcher: sent new-order push",
      );
    }
  } catch (err) {
    logger.error({ err, rawId }, "orderPushWatcher: error processing change");
  } finally {
    processingOrders.delete(rawId);
  }
}

function scheduleBroadPush(rawId: string, delayMs: number): void {
  if (broadPushTimers.has(rawId)) return;
  const timer = setTimeout(() => {
    broadPushTimers.delete(rawId);
    if (processingOrders.has(rawId)) {
      scheduleBroadPush(rawId, 250);
      return;
    }
    void handleOrderChange(rawId);
  }, Math.max(0, delayMs));
  broadPushTimers.set(rawId, timer);
}

async function reconcileAvailableOrders(): Promise<void> {
  const orders = ordersCol().find(
    {
      status: "Admin Accepted",
      $or: [
        { riderId: { $exists: false } },
        { riderId: null },
        { riderId: "" },
      ],
    },
    { projection: { _id: 1 } },
  );

  for await (const order of orders) {
    await handleOrderChange(String(order._id));
  }
}

export function startOrderPushWatcher(): void {
  subscribeToLiveChanges(
    async (change) => {
      if (change.collection === "orders") {
        await handleOrderChange(change.id);
      }
    },
    async () => {
      logger.info("orderPushWatcher: reconciling available orders after change-stream reset");
      await reconcileAvailableOrders();
    },
  );
}
