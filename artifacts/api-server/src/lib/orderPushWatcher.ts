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
import { ordersCol, subscribeToLiveChanges, usersCol } from "./mongo";
import { sendNewOrderPush } from "./onesignal";
import {
  ensureRiderOfferStartedAt,
  getActiveOrderCounts,
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
            riderZones: 1, maxOrderLimit: 1, playerId: 1,
          },
        },
      )
      .toArray();

    const counts = await getActiveOrderCounts(riders);
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
      const playerIds = recipients
        .filter((r: any) => r.playerId)
        .map((r: any) => String(r.playerId));
      const riderIds = recipients
        .filter((r: any) => !r.playerId)
        .map((r: any) => String(r._id));
      const sent = await sendNewOrderPush({
        playerIds,
        riderIds,
        orderId,
        restaurantName,
        martAddress,
      });
      if (!sent) return;

      if (priorityPhase) {
        priorityPushedOrders.add(rawId);
        priorityRecipients.set(
          rawId,
          new Set(recipients.map((r: any) => String(r._id))),
        );
      } else {
        broadPushedOrders.add(rawId);
      }
      logger.info(
        {
          orderId,
          phase: priorityPhase ? "idle-priority" : "broad",
          withPlayerId: playerIds.length,
          withExternalId: riderIds.length,
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
