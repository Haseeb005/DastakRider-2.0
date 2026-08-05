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

const APP_ID: string =
  (Constants.expoConfig?.extra?.oneSignalAppId as string | undefined) ?? "";

let initialized = false;

/**
 * Must be called once on app start (before any screen renders).
 *
 * @param onTap  Callback invoked when the rider taps a push notification.
 *               Receives the orderId embedded in the notification data.
 */
export function initOneSignal(
  onTap: (orderId: string, customerName?: string, orderNum?: string) => void,
) {
  if (!APP_ID || initialized) return;
  initialized = true;

  OneSignal.initialize(APP_ID);

  // Suppress the system notification banner when the rider is already reading
  // that order's chat — the in-app ChatBanner already handles foreground alerts.
  OneSignal.Notifications.addEventListener("foregroundWillDisplay", (event: any) => {
    const data = event.notification.additionalData as
      | Record<string, unknown>
      | undefined;
    const orderId = data?.orderId as string | undefined;

    if (orderId && getOpenChatOrderId() === orderId) {
      event.preventDefault(); // rider is in the chat — no system banner needed
    } else {
      event.getNotification().display(); // show normally
    }
  });

  // Navigate to the chat screen when the rider taps a notification.
  OneSignal.Notifications.addEventListener("click", (event: any) => {
    const data = event.notification.additionalData as
      | Record<string, unknown>
      | undefined;
    const orderId = data?.orderId as string | undefined;
    const customerName = data?.customerName as string | undefined;
    const orderNum = data?.orderNum as string | undefined;
    if (orderId) {
      onTap(orderId, customerName, orderNum);
    }
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
