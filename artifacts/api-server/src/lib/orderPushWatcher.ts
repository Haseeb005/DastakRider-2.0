/**
 * orderPushWatcher
 *
 * Watches the shared MongoDB change-event WebSocket for `orders` collection
 * changes. When an order transitions to "Admin Accepted" (unassigned), it
 * finds all online, eligible riders (matching city + zones) and sends each of
 * them a OneSignal push notification so they can tap to accept it.
 *
 * Deduplication: each orderId is pushed at most once per "Admin Accepted" window.
 * The seen-set is cleared when the order gets a riderId (accepted) or on restart.
 */

import { ObjectId } from "mongodb";
import WebSocket from "ws";

import { logger } from "./logger";
import { ordersCol, usersCol } from "./mongo";
import { sendNewOrderPush } from "./onesignal";

const WS_URL = "wss://dastakbites.com/ws/live";
const RETRY_MS = 5_000;

/** Tracks orderIds we have already pushed so we don't repeat on subsequent updates. */
const pushedOrders = new Set<string>();

async function handleOrderChange(rawId: string): Promise<void> {
  try {
    // Fetch the order document.
    let order: Record<string, any> | null = null;
    try {
      order = await ordersCol().findOne({ _id: new ObjectId(rawId) } as any);
    } catch {
      order = null;
    }

    if (!order) return;

    // Only act when the order is in "Admin Accepted" state and has no rider yet.
    if (order.status !== "Admin Accepted") return;
    const hasRider = order.riderId && order.riderId !== "";
    if (hasRider) {
      // Order was accepted — clear the dedup entry so a future re-open can push again.
      pushedOrders.delete(rawId);
      return;
    }

    // Deduplicate: only push once per order per availability window.
    if (pushedOrders.has(rawId)) return;
    pushedOrders.add(rawId);

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
      .find(riderQuery, { projection: { _id: 1 } })
      .limit(500)
      .toArray();

    if (riders.length === 0) {
      logger.info({ orderId, city, zone }, "orderPushWatcher: no online riders to notify");
      return;
    }

    const riderIds = riders.map((r: any) => String(r._id));

    await sendNewOrderPush({ riderIds, orderId, orderNum, area });
    logger.info(
      { orderId, riderCount: riderIds.length, city, zone },
      "orderPushWatcher: sent new-order push",
    );
  } catch (err) {
    logger.error({ err, rawId }, "orderPushWatcher: error processing change");
  }
}

export function startOrderPushWatcher(): void {
  function connect() {
    const ws = new WebSocket(WS_URL);

    ws.on("open", () => {
      logger.info("orderPushWatcher: connected to WS feed");
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (
          msg.type === "change" &&
          msg.collection === "orders" &&
          typeof msg.id === "string"
        ) {
          handleOrderChange(msg.id);
        }
      } catch {
        // malformed message — ignore
      }
    });

    ws.on("error", (err) => {
      logger.warn({ err: String(err) }, "orderPushWatcher: WS error");
    });

    ws.on("close", () => {
      logger.info(`orderPushWatcher: disconnected — reconnecting in ${RETRY_MS / 1000}s`);
      setTimeout(connect, RETRY_MS);
    });
  }

  connect();
}
