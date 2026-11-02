import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePushRiderLocation } from "@workspace/api-client-react";
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { ACTIVE_ORDER_IDS_KEY, LOCATION_TASK, LOCATION_ACK_KEY } from "./locationTask";

/**
 * Foreground location can be requested while the rider begins a delivery.
 * Background location is intentionally requested separately, after the rider
 * has accepted the prominent in-app disclosure shown by the Active screen.
 */
export type LocationShareStatus = "idle" | "sharing" | "error";

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 30_000;
const STALE_THRESHOLD_MS = 60_000;

/**
 * Request foreground location permission. Background permission must only be
 * requested through requestBackgroundLocationPermissionAfterDisclosure().
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
    return fg === "granted";
  } catch {
    return false;
  }
}

/** Returns whether Android background location still needs to be requested. */
export async function needsBackgroundLocationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const { status } = await Location.getBackgroundPermissionsAsync();
    return status !== "granted";
  } catch {
    return true;
  }
}

/**
 * Requests Android background location. The caller must first show the
 * prominent disclosure and receive the rider's explicit "Continue" action.
 */
export async function requestBackgroundLocationPermissionAfterDisclosure(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const { status } = await Location.requestBackgroundPermissionsAsync();
    return status === "granted";
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
  const { mutateAsync } = usePushRiderLocation();
  const mutateRef = useRef(mutateAsync);
  mutateRef.current = mutateAsync;

  const [status, setStatus] = useState<LocationShareStatus>("idle");
  const [retryCount, setRetryCount] = useState(0);
  // Serialize native start/stop and stored order IDs across effect changes.
  // Otherwise an old order's async cleanup can erase the next order's IDs.
  const backgroundQueue = useRef<Promise<void>>(Promise.resolve());
  const queueBackground = (work: () => Promise<void>) => {
    const next = backgroundQueue.current.then(work);
    backgroundQueue.current = next.catch(() => {});
    return next;
  };

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
    setStatus("idle");

    const push = async (lat: number, lng: number, timestamp: number) => {
      if (cancelled) return;
      const age = Date.now() - timestamp;
      if (!Number.isFinite(age) || age < 0 || age > 60_000) {
        setStatus("error");
        return;
      }
      try {
        await Promise.all(orderIds.map((orderId) =>
          mutateRef.current({ data: { orderId, lat, lng } }),
        ));
        if (cancelled) return;
        lastOk = Date.now();
        setStatus("sharing");
      } catch {
        if (!cancelled) setStatus("error");
      }
    };

    if (Platform.OS === "web") {
      const geo = (globalThis as any).navigator?.geolocation;
      if (geo?.watchPosition) {
        const wid = geo.watchPosition(
          (pos: any) => { void push(pos.coords.latitude, pos.coords.longitude, pos.timestamp); },
          () => { if (!cancelled) setStatus("error"); },
          { enableHighAccuracy: true, maximumAge: 5_000 },
        );
        const heartbeat = setInterval(() => {
          geo.getCurrentPosition(
            (pos: any) => { void push(pos.coords.latitude, pos.coords.longitude, pos.timestamp); },
            () => { if (!cancelled) setStatus("error"); },
            { enableHighAccuracy: true, maximumAge: 5_000, timeout: 10_000 },
          );
        }, 15_000);
        cleanup = () => { geo.clearWatch(wid); clearInterval(heartbeat); };
      } else {
        setStatus("error");
      }
    } else {
      (async () => {
        try {
          const { status: fg } = await Location.requestForegroundPermissionsAsync();
          if (cancelled) return;
          if (fg !== "granted") { setStatus("error"); return; }

          // Never prompt automatically for background access here. A request may
          // only happen after the rider accepts the dedicated in-app disclosure
          // on the "Picked up" action. Existing permission can be used safely.
          const { status: bg } = await Location.getBackgroundPermissionsAsync().catch(
            () => ({ status: "denied" as const }),
          );

          await queueBackground(async () => {
            if (cancelled) return;
            await AsyncStorage.setItem(ACTIVE_ORDER_IDS_KEY, JSON.stringify(orderIds));
            if (bg !== "granted") return;
            const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
            if (isRunning) await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});

            await Location.startLocationUpdatesAsync(LOCATION_TASK, {
              accuracy: Location.Accuracy.High,
              timeInterval: 5_000,
              distanceInterval: 0,
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
          });
          if (cancelled) return;

          // Foreground watch — runs in parallel with the background task for
          // immediate pushes while the app is on screen.
          // No distanceInterval here: updates must arrive every 5 s even when
          // the rider is stationary, otherwise the stale monitor fires a false alert.
          const sub = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.High, timeInterval: 5_000 },
            (pos) => { void push(pos.coords.latitude, pos.coords.longitude, pos.timestamp); },
          );
          if (cancelled) { sub.remove(); return; }
          cleanup = () => sub.remove();
        } catch {
          if (!cancelled) setStatus("error");
        }
      })();
    }

    // A running background task is not proof of an accepted GPS POST.
    // Only foreground or background server acknowledgements establish freshness.
    const monitor = setInterval(async () => {
      if (cancelled || Date.now() - lastOk <= STALE_THRESHOLD_MS) return;
      if (Platform.OS !== "web") {
        const ack = Number(await AsyncStorage.getItem(LOCATION_ACK_KEY).catch(() => null));
        if (ack > lastOk && ack <= Date.now()) lastOk = ack;
      }
      if (!cancelled) setStatus(Date.now() - lastOk > STALE_THRESHOLD_MS ? "error" : "sharing");
    }, 10_000);

    return () => {
      cancelled = true;
      clearInterval(monitor);
      if (cleanup) cleanup();

      if (Platform.OS !== "web") {
        void queueBackground(async () => {
          const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
          if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
          await AsyncStorage.multiRemove([ACTIVE_ORDER_IDS_KEY, LOCATION_ACK_KEY]);
        }).catch(() => {});
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
