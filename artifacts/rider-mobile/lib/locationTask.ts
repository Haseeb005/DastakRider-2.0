/**
 * Background location task — runs even when the app is minimised.
 * Defined at module level so it is registered before any component mounts.
 * Import this file as a side-effect in _layout.tsx.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as TaskManager from "expo-task-manager";

import { TOKEN_KEY } from "./auth";

export const LOCATION_TASK = "DASTAK_BG_LOCATION";
export const ACTIVE_ORDER_IDS_KEY = "dastak_active_order_ids";

const BASE_URL = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }: any) => {
  if (error || !data?.locations?.length) return;
  const { latitude: lat, longitude: lng } = data.locations[0].coords;

  try {
    const [token, idsJson] = await Promise.all([
      AsyncStorage.getItem(TOKEN_KEY),
      AsyncStorage.getItem(ACTIVE_ORDER_IDS_KEY),
    ]);
    if (!token || !BASE_URL) return;
    const orderIds: string[] = idsJson ? (JSON.parse(idsJson) as string[]) : [];
    if (!orderIds.length) return;

    await Promise.all(
      orderIds.map((orderId) =>
        fetch(`${BASE_URL}/api/rider/location`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ orderId, lat, lng }),
        }).catch(() => {}),
      ),
    );
  } catch {
    // Swallow errors — background tasks must never throw
  }
});
