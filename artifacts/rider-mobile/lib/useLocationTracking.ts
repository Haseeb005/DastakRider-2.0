import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePushRiderLocation } from "@workspace/api-client-react";
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { ACTIVE_ORDER_IDS_KEY, LOCATION_TASK } from "./locationTask";

export type LocationShareStatus = "idle" | "sharing" | "error";

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 30_000;
const STALE_THRESHOLD_MS = 60_000;

/**
 * Request foreground (and background on native) location permission.
 * Returns true only when at least foreground access is granted.
 */
export async function ensureLocationPermission(): Promise<boolean> {
  if (Platform.OS === "web") {
    const geo = (globalThis as any).navigator?.geolocation;
    if (!geo?.getCurrentPosition) return false;
    return new Promise((resolve) => {
      geo.getCurrentPosition(
        () => resolve(true),
        () => resolve(false),
        { enableHighAccuracy: true, timeout: 10_000 },
      );
    });
  }
  try {
    const { status: fg } = await Location.requestForegroundPermissionsAsync();
    if (fg !== "granted") return false;
    // Background permission — needed for tracking when the app is minimised.
    // Proceed even if denied; foreground-only tracking still works.
    await Location.requestBackgroundPermissionsAsync().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Tracks live GPS for all provided order IDs and pushes updates to the server.
 *
 * - Accepts an array so multiple concurrent "Rider Picked Up" orders are all tracked.
 * - On native: uses a background task (expo-task-manager) so tracking continues when
 *   the app is minimised, plus a foreground watchPositionAsync for immediate updates.
 * - On web: uses the browser Geolocation API.
 * - Auto-retries up to MAX_RETRIES times after a failure (30 s between attempts).
 */
export function useLocationTracking(orderIds: string[]): LocationShareStatus {
  const { mutate } = usePushRiderLocation();
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;

  const [status, setStatus] = useState<LocationShareStatus>("idle");
  const [retryCount, setRetryCount] = useState(0);

  // Key derived from IDs so the tracking effect re-runs only when the set of
  // tracked orders actually changes, not on every render.
  const idsKey = orderIds.slice().sort().join(",");

  // ── Main tracking effect ───────────────────────────────────────────────────
  useEffect(() => {
    if (!orderIds.length) {
      setStatus("idle");
      return;
    }

    let cancelled = false;
    let cleanup: (() => void) | undefined;
    let lastOk = Date.now();
    let hasFixed = false;
    setStatus("sharing");

    const push = (lat: number, lng: number) => {
      if (cancelled) return;
      lastOk = Date.now();
      hasFixed = true;
      setStatus("sharing");
      orderIds.forEach((orderId) =>
        mutateRef.current({ data: { orderId, lat, lng } }),
      );
    };

    if (Platform.OS === "web") {
      const geo = (globalThis as any).navigator?.geolocation;
      if (geo?.watchPosition) {
        const wid = geo.watchPosition(
          (pos: any) => push(pos.coords.latitude, pos.coords.longitude),
          () => { if (!cancelled) setStatus("error"); },
          { enableHighAccuracy: true, maximumAge: 5_000 },
        );
        cleanup = () => geo.clearWatch(wid);
      } else {
        setStatus("error");
      }
    } else {
      // Store IDs in AsyncStorage so the background task can read them.
      AsyncStorage.setItem(ACTIVE_ORDER_IDS_KEY, JSON.stringify(orderIds)).catch(() => {});

      (async () => {
        try {
          const { status: fg } = await Location.requestForegroundPermissionsAsync();
          if (cancelled) return;
          if (fg !== "granted") { setStatus("error"); return; }

          // Try to start the background task when background permission is available.
          const { status: bg } = await Location.requestBackgroundPermissionsAsync().catch(
            () => ({ status: "denied" as const }),
          );

          if (bg === "granted") {
            const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
            if (isRunning) await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});

            await Location.startLocationUpdatesAsync(LOCATION_TASK, {
              accuracy: Location.Accuracy.High,
              timeInterval: 5_000,
              distanceInterval: 10,
              showsBackgroundLocationIndicator: true,
              foregroundService: {
                notificationTitle: "Dastak — Live Delivery",
                notificationBody: "Sharing your location with the customer.",
                notificationColor: "#DB143C",
              },
            });
            if (cancelled) {
              await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
              return;
            }
          }

          // Foreground watch — runs in parallel with the background task for
          // immediate pushes while the app is on screen.
          const sub = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.High, timeInterval: 5_000, distanceInterval: 10 },
            (pos) => push(pos.coords.latitude, pos.coords.longitude),
          );
          if (cancelled) { sub.remove(); return; }
          cleanup = () => sub.remove();
        } catch {
          if (!cancelled) setStatus("error");
        }
      })();
    }

    // Stale-fix monitor: warn if no GPS update arrives for STALE_THRESHOLD_MS.
    // Gated on the first successful fix to avoid false alarms during cold GPS lock.
    const monitor = setInterval(() => {
      if (!cancelled && hasFixed && Date.now() - lastOk > STALE_THRESHOLD_MS) {
        setStatus("error");
      }
    }, 10_000);

    return () => {
      cancelled = true;
      clearInterval(monitor);
      if (cleanup) cleanup();

      if (Platform.OS !== "web") {
        Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)
          .then((running) => {
            if (running) Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
          })
          .catch(() => {});
        AsyncStorage.removeItem(ACTIVE_ORDER_IDS_KEY).catch(() => {});
      }

      setStatus("idle");
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, retryCount]);

  // ── Auto-retry effect ──────────────────────────────────────────────────────
  // When tracking enters the error state, schedule a retry after RETRY_DELAY_MS
  // (up to MAX_RETRIES attempts).  Incrementing retryCount re-triggers the main
  // tracking effect above.
  useEffect(() => {
    if (status !== "error" || retryCount >= MAX_RETRIES) return;
    const t = setTimeout(() => setRetryCount((c) => c + 1), RETRY_DELAY_MS);
    return () => clearTimeout(t);
  }, [status, retryCount]);

  // Reset retry counter when tracking recovers.
  useEffect(() => {
    if (status === "sharing") setRetryCount(0);
  }, [status]);

  return status;
}
