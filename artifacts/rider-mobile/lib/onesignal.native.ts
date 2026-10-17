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
const SUBSCRIPTION_RETRY_DELAYS_MS = [0, 1_000, 3_000, 7_000];

export interface PushRegistrationDiagnostics {
  appIdConfigured: boolean;
  initialized: boolean;
  permissionGranted: boolean | null;
  subscriptionId: string | null;
  subscriptionIdPresent: boolean;
  pushTokenPresent: boolean;
  optedIn: boolean | null;
  riderIdentityMatches: boolean | null;
  errorCode?: "missing_app_id" | "not_initialized" | "sdk_read_failed";
}

/** Callback registered by the app to persist the subscription ID to the server. */
let _savePlayerId: ((id: string) => void) | null = null;
let _expectedRiderId: string | null = null;

/**
 * Register a function that will be called whenever a valid OneSignal
 * subscription ID (player ID) is available. Called immediately if one
 * is already present, and again whenever it changes.
 */
export function setPlayerIdSaver(fn: (id: string) => void): void {
  _savePlayerId = fn;
  // The existing ID is only persisted after OneSignal confirms that it belongs
  // to the currently authenticated rider.
  saveCurrentSubscriptionId().catch(() => {});
}

async function saveCurrentSubscriptionId(): Promise<boolean> {
  try {
    const [id, externalId] = await Promise.all([
      OneSignal.User.pushSubscription.getIdAsync(),
      OneSignal.User.getExternalId(),
    ]);
    if (!id || !_savePlayerId || !externalId || externalId !== _expectedRiderId) {
      return false;
    }
    _savePlayerId(id);
    return true;
  } catch (error) {
    console.warn(
      "[OneSignal] Could not read the current subscription state",
      error instanceof Error ? error.name : "UnknownError",
    );
    return false;
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
  if (!APP_ID) {
    console.warn(
      "[OneSignal] App ID is missing from this build; push registration is disabled.",
    );
    return;
  }
  if (initialized) return;
  initialized = true;

  OneSignal.initialize(APP_ID);

  // Capture the subscription ID (player ID) whenever it is assigned or changes.
  // This fires after the SDK links the device to a push subscription, which may
  // happen slightly after initialize() returns.
  OneSignal.User.pushSubscription.addEventListener("change", () => {
    saveCurrentSubscriptionId().catch(() => {});
  });

  // Login can move an existing subscription to another OneSignal user without
  // changing the subscription ID. Save again when that user association changes.
  OneSignal.User.addEventListener("change", () => {
    saveCurrentSubscriptionId().catch(() => {});
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
export async function oneSignalLogin(riderId: string): Promise<void> {
  if (!APP_ID) {
    console.warn("[OneSignal] Cannot link rider: App ID is missing from this build.");
    return;
  }
  if (!riderId) {
    console.warn("[OneSignal] Cannot link rider: authenticated rider ID is missing.");
    return;
  }
  _expectedRiderId = riderId;
  OneSignal.login(riderId);

  try {
    await OneSignal.Notifications.requestPermission(true);
  } catch (error) {
    // The OS may already have a permanent permission decision. Continue so an
    // existing valid subscription can still be recovered and persisted.
    console.warn(
      "[OneSignal] Permission request failed",
      error instanceof Error ? error.name : "UnknownError",
    );
  }

  try {
    OneSignal.User.pushSubscription.optIn();
  } catch (error) {
    // Subscription creation can lag behind SDK initialization. The observer
    // registered in initOneSignal and the retries below handle that state.
    console.warn(
      "[OneSignal] Could not opt in the push subscription",
      error instanceof Error ? error.name : "UnknownError",
    );
  }

  for (const delayMs of SUBSCRIPTION_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
    if (await saveCurrentSubscriptionId()) return;
  }
  console.warn(
    "[OneSignal] No subscription ID was linked to the authenticated rider after retries.",
  );
}

/**
 * Read device registration state for the Profile diagnostics card.
 * Never return the push token; the subscription ID is only used transiently
 * by the caller to compare against the authenticated rider's saved ID.
 */
export async function getPushRegistrationDiagnostics(
  riderId: string,
): Promise<PushRegistrationDiagnostics> {
  if (!APP_ID) {
    return {
      appIdConfigured: false,
      initialized: false,
      permissionGranted: null,
      subscriptionId: null,
      subscriptionIdPresent: false,
      pushTokenPresent: false,
      optedIn: null,
      riderIdentityMatches: null,
      errorCode: "missing_app_id",
    };
  }
  if (!initialized) {
    return {
      appIdConfigured: true,
      initialized: false,
      permissionGranted: null,
      subscriptionId: null,
      subscriptionIdPresent: false,
      pushTokenPresent: false,
      optedIn: null,
      riderIdentityMatches: null,
      errorCode: "not_initialized",
    };
  }

  try {
    const [
      permissionGranted,
      subscriptionId,
      pushToken,
      optedIn,
      externalId,
    ] = await Promise.all([
      OneSignal.Notifications.getPermissionAsync(),
      OneSignal.User.pushSubscription.getIdAsync(),
      OneSignal.User.pushSubscription.getTokenAsync(),
      OneSignal.User.pushSubscription.getOptedInAsync(),
      OneSignal.User.getExternalId(),
    ]);
    return {
      appIdConfigured: true,
      initialized: true,
      permissionGranted,
      subscriptionId,
      subscriptionIdPresent: Boolean(subscriptionId),
      pushTokenPresent: Boolean(pushToken),
      optedIn,
      riderIdentityMatches: Boolean(riderId && externalId === riderId),
    };
  } catch (error) {
    console.warn(
      "[OneSignal] Registration diagnostics could not read SDK state",
      error instanceof Error ? error.name : "UnknownError",
    );
    return {
      appIdConfigured: true,
      initialized: true,
      permissionGranted: null,
      subscriptionId: null,
      subscriptionIdPresent: false,
      pushTokenPresent: false,
      optedIn: null,
      riderIdentityMatches: null,
      errorCode: "sdk_read_failed",
    };
  }
}

/**
 * Disassociate the device from the rider on logout so pushes stop arriving.
 */
export function oneSignalLogout() {
  if (!APP_ID) return;
  _expectedRiderId = null;
  _savePlayerId = null;
  OneSignal.logout();
}
