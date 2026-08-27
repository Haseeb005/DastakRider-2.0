/**
 * chatPushWatcher
 *
 * Subscribes to the local MongoDB change-event source and sends a
 * OneSignal push notification to the assigned rider whenever a new customer
 * message appears in the `chats` collection.
 *
 * This fills the gap that local expo-notifications cannot cover: when the
 * rider's app is backgrounded or killed, only a server-side push reaches them.
 *
 * Flow:
 *   1. MongoDB emits a change for a chat document.
 *   2. Fetch the chat document from MongoDB to find the latest customer message.
 *   3. Deduplicate: skip if we already pushed for this message ID.
 *   4. Throttle: at most one push per order per 10 s.
 *   5. Resolve the rider and order metadata, then call sendChatPush().
 *
 * The shared MongoDB source reconnects automatically after a stream failure.
 */

import { ObjectId } from "mongodb";
import crypto from "crypto";

import { logger } from "./logger";
import { chatsCol, ordersCol, subscribeToLiveChanges, usersCol } from "./mongo";
import { sendChatPush } from "./onesignal";

const THROTTLE_MS = 10_000;   // minimum gap between pushes for the same order

/** Last customer-message _id we sent a push for, keyed by chat document _id. */
const lastPushedMsgId = new Map<string, string>();

/** Timestamp of the last push sent for an orderId. */
const lastPushAt = new Map<string, number>();
const pendingChatTimers = new Map<string, ReturnType<typeof setTimeout>>();
const chatWork = new Map<string, Promise<void>>();
const bufferedInitialChanges = new Set<string>();
let chatDedupeReady = false;

function chatMessageKey(message: Record<string, any>, index: number): string {
  const messageId = message._id ?? message.id;
  if (messageId) return String(messageId);
  const identity = [
    "legacy",
    message.type ?? message.fromRole ?? "customer",
    message.createdAt ?? message.time ?? "",
    message.txt ?? message.text ?? "",
    index,
  ].join("\u0000");
  return `legacy:${crypto.createHash("sha256").update(identity).digest("hex")}`;
}

function latestCustomerMessage(doc: Record<string, any>): {
  message: Record<string, any>;
  index: number;
} | null {
  if (!Array.isArray(doc.chat) || doc.chat.length === 0) return null;

  const customerMsgs = (doc.chat as any[])
    .map((message, index) => ({ message, index }))
    .filter(
      ({ message }) =>
        message.type === "user" || message.fromRole === "customer",
    );
  return customerMsgs[customerMsgs.length - 1] ?? null;
}

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

    if (!doc) return;
    const latestMessage = latestCustomerMessage(doc);
    if (!latestMessage) return;

    const { message: lastMsg, index: lastMsgIndex } = latestMessage;
    const lastMsgId = chatMessageKey(lastMsg, lastMsgIndex);
    const chatKey = String(doc._id);

    // Skip if we already pushed for this exact message.
    if (lastPushedMsgId.get(chatKey) === lastMsgId) return;

    const orderId: string = doc.orderId ?? "";
    if (!orderId) return;

    const riderId: string = doc.riderId ?? "";
    if (!riderId) return;

    // Throttle per order to avoid burst pushes on rapid successive messages,
    // but retain the latest message for delivery after the window expires.
    const now = Date.now();
    const remainingThrottle =
      THROTTLE_MS - (now - (lastPushAt.get(orderId) ?? 0));
    if (remainingThrottle > 0) {
      const pendingTimer = pendingChatTimers.get(chatKey);
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingChatTimers.set(
        chatKey,
        setTimeout(() => {
          pendingChatTimers.delete(chatKey);
          enqueueChatsChange(rawId);
        }, remainingThrottle),
      );
      return;
    }

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

    // Look up the rider's OneSignal subscription ID (playerId) for direct targeting.
    let playerId: string | undefined;
    try {
      const { ObjectId: OID } = await import("mongodb");
      const rider = await usersCol().findOne(
        { _id: new OID(riderId) } as any,
        { projection: { playerId: 1 } },
      );
      playerId = rider?.playerId ? String(rider.playerId) : undefined;
    } catch {
      // riderId not a valid ObjectId or lookup failed — fall back to external_id
    }

    const sent = await sendChatPush({
      riderId,
      playerId,
      orderId,
      customerName,
      orderNum,
      messageText,
    });
    if (!sent) return;

    const pendingTimer = pendingChatTimers.get(chatKey);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingChatTimers.delete(chatKey);
    }
    lastPushedMsgId.set(chatKey, lastMsgId);
    lastPushAt.set(orderId, Date.now());
    logger.info({ riderId, orderId, hasPlayerId: !!playerId }, "chatPushWatcher: sent OneSignal push");
  } catch (err) {
    logger.error({ err, rawId }, "chatPushWatcher: error processing change");
  }
}

function enqueueChatsChange(rawId: string): Promise<void> {
  const previous = chatWork.get(rawId) ?? Promise.resolve();
  const next = previous
    .then(() => handleChatsChange(rawId))
    .finally(() => {
      if (chatWork.get(rawId) === next) {
        chatWork.delete(rawId);
      }
    });
  chatWork.set(rawId, next);
  return next;
}

async function initializeChatDedupe(): Promise<void> {
  const chats = chatsCol().find(
    {},
    { projection: { _id: 1, chat: 1 } },
  );
  for await (const doc of chats) {
    const latestMessage = latestCustomerMessage(doc);
    if (!latestMessage) continue;
    lastPushedMsgId.set(
      String(doc._id),
      chatMessageKey(latestMessage.message, latestMessage.index),
    );
  }
}

async function reconcileCustomerMessages(): Promise<void> {
  const chats = chatsCol().find(
    { riderId: { $nin: [null, ""] } },
    { projection: { _id: 1 } },
  );
  for await (const doc of chats) {
    await enqueueChatsChange(String(doc._id));
  }
}

export function startChatPushWatcher(): void {
  subscribeToLiveChanges(
    async (change) => {
      if (change.collection !== "chats") return;
      if (!chatDedupeReady) {
        bufferedInitialChanges.add(change.id);
        return;
      }
      await enqueueChatsChange(change.id);
    },
    async () => {
      logger.info("chatPushWatcher: reconciling customer messages after change-stream reset");
      await reconcileCustomerMessages();
    },
  );

  initializeChatDedupe()
    .catch((error) => {
      logger.error(
        { err: String(error) },
        "chatPushWatcher: failed to initialize deduplication baseline",
      );
    })
    .finally(() => {
      chatDedupeReady = true;
      for (const rawId of bufferedInitialChanges) {
        lastPushedMsgId.delete(rawId);
        enqueueChatsChange(rawId);
      }
      bufferedInitialChanges.clear();
    });
}
