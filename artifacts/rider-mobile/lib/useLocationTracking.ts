import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  capturedAtForFreshFix,
  pushRiderLocation,
  selectActiveDeliveryOrderIds,
} from "@workspace/api-client-react";
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import {
  ACTIVE_ORDER_IDS_KEY,
  LOCATION_ACK_KEY,
  LOCATION_ERROR_KEY,
  LOCATION_TASK,
  stopBackgroundLocationTask,
} from "./locationTrackingRuntime";

/**
 * Foreground location can be requested while the rider begins a delivery.
 * Background location is intentionally requested separately, after the rider
 * has accepted the prominent in-app disclosure shown by the Active screen.
 */
export type LocationShareStatus = "idle" | "sharing" | "error";

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
 */
export function useLocationTracking(
  orderIds: string[],
  token: string | null,
  onAuthOrAssignmentError: () => void,
): LocationShareStatus {
  const refreshRef = useRef(onAuthOrAssignmentError);
  refreshRef.current = onAuthOrAssignmentError;

  const [status, setStatus] = useState<LocationShareStatus>("idle");
  const [, setBlockedRevision] = useState(0);
  const blockedIds = useRef(new Set<string>());
  const stopGpsRef = useRef<(() => void) | null>(null);
  // Serialize native start/stop and stored order IDs across effect changes.
  // Otherwise an old order's async cleanup can erase the next order's IDs.
  const backgroundQueue = useRef<Promise<void>>(Promise.resolve());
  const queueBackground = (work: () => Promise<void>) => {
    const next = backgroundQueue.current.then(work);
    backgroundQueue.current = next.catch(() => {});
    return next;
  };

  const incomingIds = selectActiveDeliveryOrderIds(
    orderIds.map((id) => ({ id, status: "Rider Picked Up" })),
  );
  for (const blockedId of blockedIds.current) {
    if (!incomingIds.includes(blockedId)) blockedIds.current.delete(blockedId);
  }
  const publishIds = incomingIds.filter((id) => !blockedIds.current.has(id));
  const idsKey = publishIds.join(",");

  useEffect(() => {
    if (!token) {
      blockedIds.current.clear();
      setBlockedRevision((revision) => revision + 1);
    }
  }, [token]);

  // ── Main tracking effect ───────────────────────────────────────────────────
  useEffect(() => {
    if (!token || !publishIds.length) {
      setStatus(token && blockedIds.current.size ? "error" : "idle");
      if (Platform.OS !== "web") {
        void queueBackground(async () => {
          await AsyncStorage.multiRemove([
            ACTIVE_ORDER_IDS_KEY,
            LOCATION_ACK_KEY,
            LOCATION_ERROR_KEY,
          ]);
          await stopBackgroundLocationTask();
        }).catch(() => {});
      }
      return;
    }

    let cancelled = false;
    let halted = false;
    const requests = new AbortController();
    let cleanup: (() => void) | undefined;
    let lastOk = Date.now();
    setStatus("idle");

    const stopNativeTracking = () => {
      void queueBackground(async () => {
        await AsyncStorage.multiRemove([
          ACTIVE_ORDER_IDS_KEY,
          LOCATION_ACK_KEY,
          LOCATION_ERROR_KEY,
        ]);
        await stopBackgroundLocationTask();
      }).catch(() => {});
    };

    const stopForAuthOrAssignmentError = async (httpStatus: number) => {
      if (cancelled || halted) return;
      halted = true;
      requests.abort();
      publishIds.forEach((id) => blockedIds.current.add(id));
      setBlockedRevision((revision) => revision + 1);
      setStatus("error");
      stopGpsRef.current?.();
      stopGpsRef.current = null;
      if (Platform.OS !== "web") {
        await AsyncStorage.removeItem(ACTIVE_ORDER_IDS_KEY).catch(() => {});
        await AsyncStorage.setItem(LOCATION_ERROR_KEY, String(httpStatus)).catch(() => {});
        await stopBackgroundLocationTask();
      }
      void refreshRef.current();
    };

    const push = async (
      latValue: number,
      lngValue: number,
      timestamp: number,
    ) => {
      if (cancelled || halted) return;
      const capturedAt = capturedAtForFreshFix(timestamp);
      const lat = Number(latValue);
      const lng = Number(lngValue);
      if (
        !capturedAt ||
        !Number.isFinite(lat) || Math.abs(lat) > 90 ||
        !Number.isFinite(lng) || Math.abs(lng) > 180
      ) return;
      try {
        for (const orderId of publishIds) {
          await pushRiderLocation({
            orderId,
            lat,
            lng,
            capturedAt,
          }, { signal: requests.signal });
        }
        if (cancelled) return;
        lastOk = Date.now();
        setStatus("sharing");
        await AsyncStorage.setItem(LOCATION_ACK_KEY, String(lastOk)).catch(() => {});
        await AsyncStorage.removeItem(LOCATION_ERROR_KEY).catch(() => {});
      } catch (error: any) {
        const httpStatus = Number(error?.status);
        if (httpStatus === 401 || httpStatus === 403) {
          if (cancelled) {
            void refreshRef.current();
            return;
          }
          await stopForAuthOrAssignmentError(httpStatus);
          return;
        }
        // A later fresh GPS callback can try; this fix is never retried.
        if (!cancelled) setStatus("error");
      }
    };

    const handlePermissionError = () => {
      if (cancelled || halted) return;
      halted = true;
      requests.abort();
      setStatus("error");
      stopGpsRef.current?.();
      stopGpsRef.current = null;
      stopNativeTracking();
    };

    if (Platform.OS === "web") {
      const geo = (globalThis as any).navigator?.geolocation;
      if (geo?.watchPosition) {
        const wid = geo.watchPosition(
          (pos: any) => { void push(pos.coords.latitude, pos.coords.longitude, pos.timestamp); },
          handlePermissionError,
          { enableHighAccuracy: true, maximumAge: 5_000 },
        );
        const heartbeat = setInterval(() => {
          geo.getCurrentPosition(
            (pos: any) => { void push(pos.coords.latitude, pos.coords.longitude, pos.timestamp); },
            handlePermissionError,
            { enableHighAccuracy: true, maximumAge: 5_000, timeout: 10_000 },
          );
        }, 5_000);
        cleanup = () => { geo.clearWatch(wid); clearInterval(heartbeat); };
        stopGpsRef.current = cleanup;
      } else {
        handlePermissionError();
      }
    } else {
      (async () => {
        try {
          const { status: fg } = await Location.requestForegroundPermissionsAsync();
          if (cancelled) return;
          if (fg !== "granted") {
            handlePermissionError();
            return;
          }

          // Never prompt automatically for background access here. A request may
          // only happen after the rider accepts the dedicated in-app disclosure
          // on the "Picked up" action. Existing permission can be used safely.
          const { status: bg } = await Location.getBackgroundPermissionsAsync().catch(
            () => ({ status: "denied" as const }),
          );

          await queueBackground(async () => {
            if (cancelled) return;
            const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
            await AsyncStorage.multiRemove([LOCATION_ACK_KEY, LOCATION_ERROR_KEY]);
            await AsyncStorage.setItem(ACTIVE_ORDER_IDS_KEY, JSON.stringify(publishIds));
            if (bg !== "granted") {
              if (isRunning) await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
              return;
            }
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
            {
              accuracy: Location.Accuracy.High,
              timeInterval: 5_000,
              distanceInterval: 0,
            },
            (pos) => { void push(pos.coords.latitude, pos.coords.longitude, pos.timestamp); },
          );
          if (cancelled) { sub.remove(); return; }
          cleanup = () => sub.remove();
          stopGpsRef.current = cleanup;
          void Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          }).then((pos) => {
            void push(pos.coords.latitude, pos.coords.longitude, pos.timestamp);
          }).catch(() => {
            // The watch remains active and may acquire a fresh fix shortly.
          });
        } catch {
          handlePermissionError();
        }
      })();
    }

    // A running background task is not proof of an accepted GPS POST.
    // Only fresh device fixes acknowledged by the API establish freshness.
    const monitor = setInterval(async () => {
      if (cancelled || halted) return;
      if (Platform.OS !== "web") {
        const backgroundError = await AsyncStorage.getItem(LOCATION_ERROR_KEY).catch(() => null);
        if (backgroundError === "401" || backgroundError === "403") {
          await AsyncStorage.removeItem(LOCATION_ERROR_KEY).catch(() => {});
          await stopForAuthOrAssignmentError(Number(backgroundError));
          return;
        }
        if (backgroundError === "permission") {
          await AsyncStorage.removeItem(LOCATION_ERROR_KEY).catch(() => {});
          handlePermissionError();
          return;
        }
        if (AppState.currentState === "active") {
          const permission = await Location.getForegroundPermissionsAsync().catch(() => null);
          if (permission?.granted !== true) {
            handlePermissionError();
            return;
          }
        }
        const ack = Number(await AsyncStorage.getItem(LOCATION_ACK_KEY).catch(() => null));
        if (ack > lastOk && ack <= Date.now()) lastOk = ack;
      }
      if (Date.now() - lastOk > STALE_THRESHOLD_MS) setStatus("error");
    }, 5_000);

    return () => {
      cancelled = true;
      requests.abort();
      clearInterval(monitor);
      if (cleanup) cleanup();
      if (stopGpsRef.current === cleanup) stopGpsRef.current = null;

      if (Platform.OS !== "web") {
        void queueBackground(async () => {
          await AsyncStorage.multiRemove([
            ACTIVE_ORDER_IDS_KEY,
            LOCATION_ACK_KEY,
            LOCATION_ERROR_KEY,
          ]);
          await stopBackgroundLocationTask();
        }).catch(() => {});
      }

      setStatus("idle");
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, token]);

  return status;
}
