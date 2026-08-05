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

export function initOneSignal(_onTap: (e: PushTapEvent) => void) {}

export function oneSignalLogin(_riderId: string) {}

export function oneSignalLogout() {}
