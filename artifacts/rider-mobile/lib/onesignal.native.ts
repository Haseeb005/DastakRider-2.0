/**
 * OneSignal helper for the Dastak Rider mobile app.
 *
 * Responsibilities:
 *  - Initialize the OneSignal SDK once on app start.
 *  - Login / logout the rider so the server can target them by external ID.
 *  - Suppress the system notification banner when the rider is already inside
 *    the relevant chat screen (avoiding a double-notification with the in-app
 *    ChatBanner).
 *  - Navigate to the chat screen when the rider taps a push notification.
 *
 * The OneSignal external ID used here is the rider's MongoDB _id (string).
 * Server-side, OneSignal.include_aliases.external_id = [riderId] targets the
 * exact device(s) that rider is logged in on.
 */

import Constants from "expo-constants";
import { OneSignal } from "react-native-onesignal";

import { getOpenChatOrderId } from "./chatBadgeStore";

// EXPO_PUBLIC_ONESIGNAL_APP_ID_RIDER is the preferred source — it is embedded
// in the JS bundle at EAS build time. The extra.oneSignalAppId fallback
// supports older builds that used the dynamic app.config.js.
const APP_ID: string =
  process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID_RIDER ??
  (Constants.expoConfig?.extra?.oneSignalAppId as string | undefined) ??
  "";

let initialized = false;

/** Callback registered by the app to persist the subscription ID to the server. */
let _savePlayerId: ((id: string) => void) | null = null;

/**
 * Register a function that will be called whenever a valid OneSignal
 * subscription ID (player ID) is available. Called immediately if one
 * is already present, and again whenever it changes.
 */
export function setPlayerIdSaver(fn: (id: string) => void): void {
  _savePlayerId = fn;
  // If a subscription ID already exists (e.g. rider re-opens app), fire now.
  try {
    const id = OneSignal.User.pushSubscription.id;
    if (id) fn(id);
  } catch {
    // SDK not initialised yet — listener below will fire when ready.
  }
}

export type PushScreen = "chat" | "newOrder";

export interface PushTapEvent {
  screen: PushScreen;
  orderId?: string;
  customerName?: string;
  orderNum?: string;
}

/**
 * Must be called once on app start (before any screen renders).
 *
 * @param onTap  Callback invoked when the rider taps a push notification.
 */
export function initOneSignal(onTap: (e: PushTapEvent) => void) {
  if (!APP_ID || initialized) return;
  initialized = true;

  OneSignal.initialize(APP_ID);

  // Capture the subscription ID (player ID) whenever it is assigned or changes.
  // This fires after the SDK links the device to a push subscription, which may
  // happen slightly after initialize() returns.
  OneSignal.User.pushSubscription.addEventListener("change", (event: any) => {
    const id: string | undefined = event?.current?.id;
    if (id && _savePlayerId) _savePlayerId(id);
  });

  // Suppress the system notification banner when the rider is already reading
  // that order's chat — the in-app ChatBanner already handles foreground alerts.
  OneSignal.Notifications.addEventListener("foregroundWillDisplay", (event: any) => {
    const data = event.notification.additionalData as
      | Record<string, unknown>
      | undefined;
    const screen = data?.screen as string | undefined;
    const orderId = data?.orderId as string | undefined;

    // Only suppress chat notifications when the rider is already in that chat.
    if (screen === "chat" && orderId && getOpenChatOrderId() === orderId) {
      event.preventDefault();
    } else {
      event.getNotification().display();
    }
  });

  // Navigate when the rider taps a notification.
  OneSignal.Notifications.addEventListener("click", (event: any) => {
    const data = event.notification.additionalData as
      | Record<string, unknown>
      | undefined;
    const screen = (data?.screen as PushScreen | undefined) ?? "chat";
    const orderId = data?.orderId as string | undefined;
    const customerName = data?.customerName as string | undefined;
    const orderNum = data?.orderNum as string | undefined;
    onTap({ screen, orderId, customerName, orderNum });
  });
}

/**
 * Associate the current device with this rider in OneSignal.
 * Call this immediately after the rider authenticates.
 */
export function oneSignalLogin(riderId: string) {
  if (!APP_ID || !riderId) return;
  OneSignal.login(riderId);
}

/**
 * Disassociate the device from the rider on logout so pushes stop arriving.
 */
export function oneSignalLogout() {
  if (!APP_ID) return;
  OneSignal.logout();
}
