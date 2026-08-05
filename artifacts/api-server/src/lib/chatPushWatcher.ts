/**
 * chatPushWatcher
 *
 * Connects to the shared MongoDB change-event WebSocket feed and sends a
 * OneSignal push notification to the assigned rider whenever a new customer
 * message appears in the `chats` collection.
 *
 * This fills the gap that local expo-notifications cannot cover: when the
 * rider's app is backgrounded or killed, only a server-side push reaches them.
 *
 * Flow:
 *   1. WS receives { type:"change", collection:"chats", id:"<docId>" }
 *   2. Fetch the chat document from MongoDB to find the latest customer message.
 *   3. Deduplicate: skip if we already pushed for this message ID.
 *   4. Throttle: at most one push per order per 10 s.
 *   5. Resolve the rider and order metadata, then call sendChatPush().
 *
 * The watcher reconnects automatically on WS close/error.
 */

import { ObjectId } from "mongodb";
import WebSocket from "ws";

import { logger } from "./logger";
import { chatsCol, ordersCol } from "./mongo";
import { sendChatPush } from "./onesignal";

const WS_URL = "wss://dastakbites.com/ws/live";
const THROTTLE_MS = 10_000;   // minimum gap between pushes for the same order
const RETRY_MS = 5_000;       // WS reconnect delay

/** Last customer-message _id we sent a push for, keyed by chat document _id. */
const lastPushedMsgId = new Map<string, string>();

/** Timestamp of the last push sent for an orderId. */
const lastPushAt = new Map<string, number>();

async function handleChatsChange(rawId: string): Promise<void> {
  try {
    // The WS event `id` is the chat document's _id as a hex string.
    // Attempt ObjectId parse; fall back to a string match on orderId.
    let doc: Record<string, any> | null = null;

    try {
      doc = await chatsCol().findOne({ _id: new ObjectId(rawId) } as any);
    } catch {
      // rawId is not a valid ObjectId — try treating it as orderId
      doc = await chatsCol().findOne({ orderId: rawId } as any);
    }

    if (!doc || !Array.isArray(doc.chat) || doc.chat.length === 0) return;

    // Find the most recent message from a customer (type "user").
    const customerMsgs = (doc.chat as any[]).filter(
      (m) => m.type === "user" || m.fromRole === "customer",
    );
    if (customerMsgs.length === 0) return;

    const lastMsg = customerMsgs[customerMsgs.length - 1];
    const lastMsgId = String(lastMsg._id);
    const chatKey = String(doc._id);

    // Skip if we already pushed for this exact message.
    if (lastPushedMsgId.get(chatKey) === lastMsgId) return;
    lastPushedMsgId.set(chatKey, lastMsgId);

    // Throttle per order to avoid burst pushes on rapid successive messages.
    const orderId: string = doc.orderId ?? "";
    if (!orderId) return;

    const now = Date.now();
    if (now - (lastPushAt.get(orderId) ?? 0) < THROTTLE_MS) return;
    lastPushAt.set(orderId, now);

    const riderId: string = doc.riderId ?? "";
    if (!riderId) return;

    // Resolve order metadata (customer name + order number) for the notification.
    let customerName: string | undefined;
    let orderNum: string | undefined;
    try {
      const order = await ordersCol().findOne({
        _id: new ObjectId(orderId),
      } as any);
      customerName =
        (order?.userName as string | undefined) ??
        (order?.name as string | undefined) ??
        undefined;
      orderNum = order?.orderNum ? String(order.orderNum) : undefined;
    } catch {
      // orderId may not be a valid ObjectId — skip metadata
    }

    const messageText = lastMsg.txt
      ? String(lastMsg.txt).slice(0, 80)
      : undefined;

    await sendChatPush({ riderId, orderId, customerName, orderNum, messageText });
    logger.info({ riderId, orderId }, "chatPushWatcher: sent OneSignal push");
  } catch (err) {
    logger.error({ err, rawId }, "chatPushWatcher: error processing change");
  }
}

export function startChatPushWatcher(): void {
  function connect() {
    const ws = new WebSocket(WS_URL);

    ws.on("open", () => {
      logger.info("chatPushWatcher: connected to WS feed");
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (
          msg.type === "change" &&
          msg.collection === "chats" &&
          typeof msg.id === "string"
        ) {
          handleChatsChange(msg.id);
        }
      } catch {
        // malformed message — ignore
      }
    });

    ws.on("error", (err) => {
      logger.warn({ err: String(err) }, "chatPushWatcher: WS error");
    });

    ws.on("close", () => {
      logger.info(`chatPushWatcher: disconnected — reconnecting in ${RETRY_MS / 1000}s`);
      setTimeout(connect, RETRY_MS);
    });
  }

  connect();
}
