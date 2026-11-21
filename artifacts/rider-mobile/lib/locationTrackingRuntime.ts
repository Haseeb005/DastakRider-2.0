import * as Location from "expo-location";

export const LOCATION_TASK = "DASTAK_BG_LOCATION";
export const ACTIVE_ORDER_IDS_KEY = "dastak_active_order_ids";
export const LOCATION_ACK_KEY = "dastak_location_last_ack";
export const LOCATION_ERROR_KEY = "dastak_location_last_error";

export async function stopBackgroundLocationTask(): Promise<void> {
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    // Sign-out and assignment cleanup must not fail if the OS already stopped it.
  }
}
