import { usePushRiderLocation } from "@workspace/api-client-react";
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

export type LocationShareStatus = "idle" | "sharing" | "error";

/**
 * Request live-location permission from the rider. Resolves true only when the
 * rider has granted access. Used to FORCE location sharing before a delivery can
 * start, so the customer can always track the order in transit.
 */
export async function ensureLocationPermission(): Promise<boolean> {
  if (Platform.OS === "web") {
    const geo = (globalThis as any).navigator?.geolocation;
    if (!geo?.getCurrentPosition) return false;
    return new Promise((resolve) => {
      geo.getCurrentPosition(
        () => resolve(true),
        () => resolve(false),
        { enableHighAccuracy: true, timeout: 10000 },
      );
    });
  }
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

/**
 * While an active order is in progress, push the rider's GPS coordinates to the
 * server (powers the customer's live tracking map). Native uses expo-location;
 * web falls back to the browser geolocation API.
 */
export function useLocationTracking(
  orderId: string | null,
): LocationShareStatus {
  const { mutate } = usePushRiderLocation();
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;
  const [status, setStatus] = useState<LocationShareStatus>("idle");

  useEffect(() => {
    if (!orderId) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    let lastOk = Date.now();
    let hasFixed = false;
    setStatus("sharing");

    const push = (lat: number, lng: number) => {
      if (cancelled || !orderId) return;
      lastOk = Date.now();
      hasFixed = true;
      setStatus("sharing");
      mutateRef.current({ data: { orderId, lat, lng } });
    };

    if (Platform.OS === "web") {
      const geo = (globalThis as any).navigator?.geolocation;
      if (geo?.watchPosition) {
        const wid = geo.watchPosition(
          (pos: any) => push(pos.coords.latitude, pos.coords.longitude),
          () => {
            if (!cancelled) setStatus("error");
          },
          { enableHighAccuracy: true, maximumAge: 5000 },
        );
        cleanup = () => geo.clearWatch(wid);
      } else {
        setStatus("error");
      }
    } else {
      (async () => {
        try {
          const { status: perm } =
            await Location.requestForegroundPermissionsAsync();
          if (cancelled) return;
          if (perm !== "granted") {
            setStatus("error");
            return;
          }
          const sub = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.High,
              timeInterval: 10000,
              distanceInterval: 25,
            },
            (pos) => push(pos.coords.latitude, pos.coords.longitude),
          );
          if (cancelled) sub.remove();
          else cleanup = () => sub.remove();
        } catch {
          if (!cancelled) setStatus("error");
        }
      })();
    }

    // Once sharing has started, warn if no fresh fix arrives for a while. Gated
    // on the first successful fix so a slow initial GPS lock isn't a false alarm.
    const monitor = setInterval(() => {
      if (!cancelled && hasFixed && Date.now() - lastOk > 60000)
        setStatus("error");
    }, 10000);

    return () => {
      cancelled = true;
      clearInterval(monitor);
      if (cleanup) cleanup();
      setStatus("idle");
    };
  }, [orderId]);

  return status;
}
