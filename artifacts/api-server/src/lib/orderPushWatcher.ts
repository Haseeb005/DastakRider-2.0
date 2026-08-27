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

/** Tracks orderIds we have already pushed so we don't repeat on subsequent updates. */
const pushedOrders = new Set<string>();
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
      pushedOrders.delete(rawId);
      return;
    }

    // Deduplicate: only push once per order per availability window.
    if (pushedOrders.has(rawId)) return;
    const city: string = order.city ?? "";
    const zone: string = order.zone ?? "";
    const orderId = String(order._id);
    const orderNum = order.orderNum ? String(order.orderNum) : undefined;
    const area: string | undefined = zone || order.area || undefined;

    // Find all online riders eligible for this order (same city + zone match).
    const riderQuery: Record<string, any> = {
      type: "rider",
      isOnline: true,
      deleted: { $ne: true },
    };
    if (city) riderQuery.city = city;
    // Zone filter: if the order has a zone, only notify riders whose riderZones
    // include it OR riders with no zones assigned (they see everything in their city).
    if (zone) {
      riderQuery.$or = [
        { riderZones: zone },
        { riderZones: { $exists: false } },
        { riderZones: { $size: 0 } },
      ];
    }

    const riders = await usersCol()
      .find(riderQuery, { projection: { _id: 1, playerId: 1 } })
      .limit(500)
      .toArray();

    if (riders.length === 0) {
      logger.info({ orderId, city, zone }, "orderPushWatcher: no online riders to notify");
      return;
    }

    // Prefer subscription IDs (stored in riders.playerId) for direct targeting.
    // Fall back to external_id alias for riders that haven't saved a playerId yet.
    const playerIds = riders
      .filter((r: any) => r.playerId)
      .map((r: any) => String(r.playerId));
    const riderIds = riders
      .filter((r: any) => !r.playerId)
      .map((r: any) => String(r._id));

    const sent = await sendNewOrderPush({
      playerIds,
      riderIds,
      orderId,
      orderNum,
      area,
    });
    if (!sent) return;

    pushedOrders.add(rawId);
    logger.info(
      { orderId, withPlayerId: playerIds.length, withExternalId: riderIds.length, city, zone },
      "orderPushWatcher: sent new-order push",
    );
  } catch (err) {
    logger.error({ err, rawId }, "orderPushWatcher: error processing change");
  } finally {
    processingOrders.delete(rawId);
  }
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
