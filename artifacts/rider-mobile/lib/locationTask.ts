/**
 * Background location task — runs even when the app is minimised.
 * Defined at module level so it is registered before any component mounts.
 * Import this file as a side-effect in _layout.tsx.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as TaskManager from "expo-task-manager";

import { API_BASE_URL } from "./apiBase";
import { TOKEN_KEY } from "./auth";

export const LOCATION_TASK = "DASTAK_BG_LOCATION";
export const ACTIVE_ORDER_IDS_KEY = "dastak_active_order_ids";
export const LOCATION_ACK_KEY = "dastak_location_last_ack";

const BASE_URL = API_BASE_URL;

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }: any) => {
  if (error || !data?.locations?.length) return;
  // A background batch can contain old fixes. Never present a cached fix as live.
  const fix = [...data.locations].sort((a, b) => b.timestamp - a.timestamp)[0];
  const age = Date.now() - fix.timestamp;
  if (!Number.isFinite(age) || age < 0 || age > 60_000) return;
  const { latitude: lat, longitude: lng } = fix.coords;

  try {
    const [token, idsJson] = await Promise.all([
      AsyncStorage.getItem(TOKEN_KEY),
      AsyncStorage.getItem(ACTIVE_ORDER_IDS_KEY),
    ]);
    if (!token || !BASE_URL) return;
    const orderIds: string[] = idsJson ? (JSON.parse(idsJson) as string[]) : [];
    if (!orderIds.length) return;

    const accepted = await Promise.all(
      orderIds.map((orderId) =>
        fetch(`${BASE_URL}/api/rider/location`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ orderId, lat, lng }),
        }).then((response) => {
          if (!response.ok) {
            console.warn(`[Location] Background publish rejected (${response.status})`);
          }
          return response.ok;
        }).catch(() => {
          console.warn("[Location] Background publish failed");
          return false;
        }),
      ),
    );
    if (accepted.every(Boolean)) {
      await AsyncStorage.setItem(LOCATION_ACK_KEY, String(Date.now()));
    }
  } catch {
    console.warn("[Location] Background tracking unavailable");
  }
});
