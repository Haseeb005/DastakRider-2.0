/**
 * Web stub — expo-notifications is native-only.
 * Metro picks localPush.native.ts on device; this file is used on web/Expo Go web.
 */

export type EventSubscription = { remove(): void };

export function setNotificationHandler(_handler: unknown) {}

export async function requestPermissionsAsync() {
  return { status: "denied" as const };
}

export function scheduleNotificationAsync(_options: unknown): Promise<string> {
  return Promise.resolve("");
}

export function addNotificationResponseReceivedListener(
  _listener: unknown,
): EventSubscription {
  return { remove() {} };
}
