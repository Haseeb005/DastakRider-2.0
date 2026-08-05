/**
 * OneSignal push notification helper — server side.
 *
 * Sends a push to a specific rider using OneSignal's REST API v1,
 * targeting by external_id (= the rider's MongoDB _id string).
 *
 * Env vars required:
 *   ONESIGNAL_APP_ID_RIDER       — OneSignal application ID
 *   ONESIGNAL_REST_API_KEY_RIDER — REST API key (from OneSignal dashboard)
 */

import { logger } from "./logger";

const APP_ID = process.env.ONESIGNAL_APP_ID_RIDER ?? "";
const REST_KEY = process.env.ONESIGNAL_REST_API_KEY_RIDER ?? "";

export interface ChatPushPayload {
  /** Rider's MongoDB _id (string) — used as OneSignal external_id. */
  riderId: string;
  orderId: string;
  customerName?: string;
  orderNum?: string;
  /** First ~80 chars of the customer's message shown in the notification body. */
  messageText?: string;
}

export interface NewOrderPushPayload {
  /** Array of rider MongoDB _ids to notify (OneSignal accepts up to 2 000). */
  riderIds: string[];
  orderId: string;
  orderNum?: string;
  area?: string;
}

/** Fire-and-forget POST to the OneSignal REST API. */
async function postNotification(body: Record<string, unknown>): Promise<void> {
  if (!APP_ID || !REST_KEY) return;
  try {
    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${REST_KEY}`,
      },
      body: JSON.stringify({ app_id: APP_ID, ...body }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error({ status: res.status, body: text }, "OneSignal API error");
    }
  } catch (err) {
    logger.error({ err }, "OneSignal: network error");
  }
}

/**
 * Send a push notification to the given rider about a new customer chat message.
 * Silently no-ops when the env vars are not configured.
 */
export async function sendChatPush(payload: ChatPushPayload): Promise<void> {
  if (!APP_ID || !REST_KEY) {
    logger.warn("sendChatPush: ONESIGNAL env vars not set — skipping");
    return;
  }
  const { riderId, orderId, customerName, orderNum, messageText } = payload;
  await postNotification({
    include_aliases: { external_id: [riderId] },
    target_channel: "push",
    headings: { en: customerName ? `Message from ${customerName}` : "New message from customer" },
    contents: { en: messageText || "Tap to reply" },
    data: {
      screen: "chat",
      orderId,
      ...(customerName ? { customerName } : {}),
      ...(orderNum ? { orderNum } : {}),
    },
    android_channel_id: "default",
    ios_badge_type: "Increase",
    ios_badge_count: 1,
  });
}

/**
 * Send a new-order push to multiple riders simultaneously.
 * OneSignal accepts up to 2 000 external_ids per request.
 */
export async function sendNewOrderPush(payload: NewOrderPushPayload): Promise<void> {
  if (!APP_ID || !REST_KEY) {
    logger.warn("sendNewOrderPush: ONESIGNAL env vars not set — skipping");
    return;
  }
  const { riderIds, orderId, orderNum, area } = payload;
  if (riderIds.length === 0) return;

  const heading = "New Order Available";
  const body = [
    orderNum ? `Order #${orderNum}` : "A new order is waiting",
    area ? `· ${area}` : "",
  ]
    .join(" ")
    .trim();

  await postNotification({
    include_aliases: { external_id: riderIds },
    target_channel: "push",
    headings: { en: heading },
    contents: { en: body },
    data: {
      screen: "newOrder",
      orderId,
      ...(orderNum ? { orderNum } : {}),
    },
    android_channel_id: "default",
    ios_badge_type: "Increase",
    ios_badge_count: 1,
  });
}
