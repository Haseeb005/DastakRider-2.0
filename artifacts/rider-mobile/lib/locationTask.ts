/**
 * Background location task — runs even when the app is minimised.
 * Defined at module level so it is registered before any component mounts.
 * Import this file as a side-effect in _layout.tsx.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  capturedAtForFreshFix,
  pushRiderLocation,
  selectActiveDeliveryOrderIds,
} from "@workspace/api-client-react";
import * as TaskManager from "expo-task-manager";

import {
  ACTIVE_ORDER_IDS_KEY,
  LOCATION_ACK_KEY,
  LOCATION_ERROR_KEY,
  LOCATION_TASK,
  stopBackgroundLocationTask,
} from "./locationTrackingRuntime";

export { ACTIVE_ORDER_IDS_KEY, LOCATION_ACK_KEY, LOCATION_ERROR_KEY, LOCATION_TASK };

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }: any) => {
  if (error) {
    await AsyncStorage.setItem(LOCATION_ERROR_KEY, "permission").catch(() => {});
    await AsyncStorage.removeItem(ACTIVE_ORDER_IDS_KEY).catch(() => {});
    await stopBackgroundLocationTask();
    return;
  }
  if (!data?.locations?.length) return;
  // A background batch can contain old fixes. Choose the newest fresh device fix.
  const fix = data.locations
    .filter((location: any) => capturedAtForFreshFix(location?.timestamp))
    .sort((a: any, b: any) => b.timestamp - a.timestamp)[0];
  if (!fix) return;
  const capturedAt = capturedAtForFreshFix(fix.timestamp);
  if (!capturedAt) return;
  const lat = Number(fix.coords?.latitude);
  const lng = Number(fix.coords?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  try {
    const idsJson = await AsyncStorage.getItem(ACTIVE_ORDER_IDS_KEY);
    const storedIds: string[] = idsJson ? (JSON.parse(idsJson) as string[]) : [];
    const orderIds = selectActiveDeliveryOrderIds(
      storedIds.map((id) => ({ id, status: "Rider Picked Up" })),
    );
    if (!orderIds.length) return;

    for (const orderId of orderIds) {
      try {
        await pushRiderLocation({ orderId, lat, lng, capturedAt });
      } catch (publishError: any) {
        const status = Number(publishError?.status);
        if (status === 401 || status === 403) {
          await AsyncStorage.setItem(LOCATION_ERROR_KEY, String(status));
          await AsyncStorage.removeItem(ACTIVE_ORDER_IDS_KEY);
          await stopBackgroundLocationTask();
          return;
        }
        // No retry of this fix. A later genuine GPS fix may publish normally.
        return;
      }
    }
    await AsyncStorage.setItem(LOCATION_ACK_KEY, String(Date.now()));
    await AsyncStorage.removeItem(LOCATION_ERROR_KEY);
  } catch {
    // Do not log request payloads, coordinates, rider IDs or tokens.
  }
});
