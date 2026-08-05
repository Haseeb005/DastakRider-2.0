/**
 * Native implementation — delegates to expo-notifications.
 * Metro picks this file on iOS/Android; localPush.ts (stub) is used on web.
 */
import * as Notifications from "expo-notifications";

export type EventSubscription = Notifications.EventSubscription;

export function setNotificationHandler(
  handler: Parameters<typeof Notifications.setNotificationHandler>[0],
) {
  Notifications.setNotificationHandler(handler);
}

export async function requestPermissionsAsync() {
  return Notifications.requestPermissionsAsync();
}

export function scheduleNotificationAsync(
  options: Parameters<typeof Notifications.scheduleNotificationAsync>[0],
) {
  return Notifications.scheduleNotificationAsync(options);
}

export function addNotificationResponseReceivedListener(
  listener: Parameters<
    typeof Notifications.addNotificationResponseReceivedListener
  >[0],
): EventSubscription {
  return Notifications.addNotificationResponseReceivedListener(listener);
}
