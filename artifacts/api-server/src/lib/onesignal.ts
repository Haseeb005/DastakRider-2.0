/**
 * OneSignal push notification helper — server side.
 *
 * Sends rider pushes through OneSignal's official Node SDK, targeting the
 * saved subscription ID when available and the rider external_id as fallback.
 *
 * Env vars required:
 *   ONE_SIGNAL_RIDER_APP_ID or ONESIGNAL_APP_ID_RIDER
 *   ONE_SIGNAL_RIDER_REST_API_KEY or ONESIGNAL_REST_API_KEY_RIDER
 */

import {
  createConfiguration,
  DefaultApi,
  Notification,
} from "@onesignal/node-onesignal";

import { logger } from "./logger";

const APP_ID =
  process.env.ONE_SIGNAL_RIDER_APP_ID ??
  process.env.ONESIGNAL_APP_ID_RIDER ??
  "";
const REST_KEY =
  process.env.ONE_SIGNAL_RIDER_REST_API_KEY ??
  process.env.ONESIGNAL_REST_API_KEY_RIDER ??
  "";
const riderClient =
  APP_ID && REST_KEY
    ? new DefaultApi(createConfiguration({ restApiKey: REST_KEY }))
    : null;
const RIDER_ANDROID_CHANNEL_ID = "978916b0-393b-4003-a090-405ccab2d321";
const RIDER_LARGE_ICON =
  "https://res.cloudinary.com/hmwday8rj/image/upload/v1596543000/ios_icon_rrtypi.png";

export interface ChatPushPayload {
  /** Rider's MongoDB _id (string) — fallback if playerId is absent. */
  riderId: string;
  /** OneSignal subscription ID stored on the rider document. Preferred. */
  playerId?: string;
  orderId: string;
  customerName?: string;
  orderNum?: string;
  /** First ~80 chars of the customer's message shown in the notification body. */
  messageText?: string;
}

export interface NewOrderPushPayload {
  /** OneSignal subscription IDs (from riders.playerId). Primary targeting method. */
  playerIds: string[];
  /** Rider MongoDB _ids for devices that have no playerId yet — uses external_id alias. */
  riderIds?: string[];
  orderId: string;
  orderNum?: string;
  area?: string;
}

interface RiderNotificationPayload {
  message: string;
  heading?: string;
  subscriptionIds?: string[];
  riderIds?: string[];
  data?: Record<string, unknown>;
}

/** Send one rider notification through the official OneSignal Node SDK. */
async function notifyRiders(payload: RiderNotificationPayload): Promise<void> {
  const subscriptionIds = payload.subscriptionIds ?? [];
  const riderIds = payload.riderIds ?? [];
  if (!riderClient || !APP_ID || !REST_KEY) {
    logger.warn("notifyRiders: OneSignal env vars not set — skipping");
    return;
  }
  if (subscriptionIds.length === 0 && riderIds.length === 0) return;

  const notification = new Notification();
  notification.app_id = APP_ID;
  if (subscriptionIds.length > 0) {
    notification.include_subscription_ids = subscriptionIds;
  }
  if (riderIds.length > 0) {
    notification.include_aliases = { external_id: riderIds };
  }
  notification.target_channel = "push";
  notification.data = payload.data ?? {};
  notification.ios_sound = "dastak.wav";
  notification.android_sound = "dastak";
  notification.android_channel_id = RIDER_ANDROID_CHANNEL_ID;
  notification.small_icon = "ic_stat_onesignal_default";
  notification.large_icon = RIDER_LARGE_ICON;
  notification.headings = { en: payload.heading ?? "Dastak Rider" };
  notification.contents = { en: payload.message };

  try {
    const result = await riderClient.createNotification(notification);
    logger.info(
      {
        notificationId: result.id,
        subscriptionCount: subscriptionIds.length,
        riderCount: riderIds.length,
      },
      "OneSignal: rider notification accepted",
    );
  } catch (error: any) {
    const errors = error?.body?.errors;
    logger.error(
      {
        errors: Array.isArray(errors) ? errors.join(", ") : error?.message,
        subscriptionCount: subscriptionIds.length,
        riderCount: riderIds.length,
      },
      "OneSignal: rider notification failed",
    );
  }
}

/**
 * Send a push notification to the given rider about a new customer chat message.
 * Silently no-ops when the env vars are not configured.
 */
export async function sendChatPush(payload: ChatPushPayload): Promise<void> {
  const { riderId, playerId, orderId, customerName, orderNum, messageText } = payload;
  await notifyRiders({
    message: messageText || "Tap to reply",
    heading: customerName ? `Message from ${customerName}` : "New message from customer",
    subscriptionIds: playerId ? [playerId] : undefined,
    riderIds: playerId ? undefined : [riderId],
    data: {
      screen: "chat",
      orderId,
      ...(customerName ? { customerName } : {}),
      ...(orderNum ? { orderNum } : {}),
    },
  });
}

/**
 * Send a new-order push to multiple riders simultaneously.
 * OneSignal accepts up to 2 000 external_ids per request.
 */
export async function sendNewOrderPush(payload: NewOrderPushPayload): Promise<void> {
  const { playerIds, riderIds = [], orderId, orderNum, area } = payload;

  const heading = "New Order Available";
  const body = [
    orderNum ? `Order #${orderNum}` : "A new order is waiting",
    area ? `· ${area}` : "",
  ]
    .join(" ")
    .trim();

  const data = {
    screen: "newOrder",
    orderId,
    ...(orderNum ? { orderNum } : {}),
  };
  await notifyRiders({
    message: body,
    heading,
    subscriptionIds: playerIds,
    riderIds,
    data,
  });
}
