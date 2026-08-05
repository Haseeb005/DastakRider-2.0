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

/**
 * Send a push notification to the given rider about a new customer chat message.
 * Silently no-ops when the env vars are not configured.
 */
export async function sendChatPush(payload: ChatPushPayload): Promise<void> {
  if (!APP_ID || !REST_KEY) {
    logger.warn("sendChatPush: ONESIGNAL_APP_ID_RIDER or ONESIGNAL_REST_API_KEY_RIDER not set — skipping push");
    return;
  }

  const { riderId, orderId, customerName, orderNum, messageText } = payload;

  const heading = customerName
    ? `Message from ${customerName}`
    : "New message from customer";
  const body = messageText || "Tap to reply";

  try {
    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${REST_KEY}`,
      },
      body: JSON.stringify({
        app_id: APP_ID,
        // Target this specific rider by their external user ID (= riderId).
        include_aliases: { external_id: [riderId] },
        target_channel: "push",
        headings: { en: heading },
        contents: { en: body },
        // Data payload — read by OneSignal click handler to navigate to chat.
        data: {
          screen: "chat",
          orderId,
          ...(customerName ? { customerName } : {}),
          ...(orderNum ? { orderNum } : {}),
        },
        android_channel_id: "default",
        ios_badge_type: "Increase",
        ios_badge_count: 1,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error({ status: res.status, body: text }, "sendChatPush: OneSignal API error");
    }
  } catch (err) {
    logger.error({ err }, "sendChatPush: network error");
  }
}
