/**
 * Web/Expo-Go stub — OneSignal is native-only.
 * Metro picks onesignal.native.ts on device; this file is used on web.
 */

export type PushScreen = "chat" | "newOrder";

export interface PushTapEvent {
  screen: PushScreen;
  orderId?: string;
  customerName?: string;
  orderNum?: string;
}

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

export function initOneSignal(_onTap: (e: PushTapEvent) => void) {}

export async function oneSignalLogin(_riderId: string): Promise<void> {}

export function oneSignalLogout() {}

export async function getPushRegistrationDiagnostics(
  _riderId: string,
): Promise<PushRegistrationDiagnostics> {
  return {
    appIdConfigured: false,
    initialized: false,
    permissionGranted: null,
    subscriptionId: null,
    subscriptionIdPresent: false,
    pushTokenPresent: false,
    optedIn: null,
    riderIdentityMatches: null,
  };
}

/** No-op on web — subscription IDs are native-only. */
export function setPlayerIdSaver(_fn: (id: string) => void) {}
