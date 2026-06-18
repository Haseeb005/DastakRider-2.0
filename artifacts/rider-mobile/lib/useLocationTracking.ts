import { usePushRiderLocation } from "@workspace/api-client-react";
import * as Location from "expo-location";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

/**
 * While an active order is in progress, push the rider's GPS coordinates to the
 * server (powers the customer's live tracking map). Native uses expo-location;
 * web falls back to the browser geolocation API.
 */
export function useLocationTracking(orderId: string | null) {
  const { mutate } = usePushRiderLocation();
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    const push = (lat: number, lng: number) => {
      if (cancelled || !orderId) return;
      mutateRef.current({ data: { orderId, lat, lng } });
    };

    if (Platform.OS === "web") {
      const geo = (globalThis as any).navigator?.geolocation;
      if (geo?.watchPosition) {
        const wid = geo.watchPosition(
          (pos: any) => push(pos.coords.latitude, pos.coords.longitude),
          () => {},
          { enableHighAccuracy: true, maximumAge: 5000 },
        );
        cleanup = () => geo.clearWatch(wid);
      }
    } else {
      (async () => {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== "granted" || cancelled) return;
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
          // permission or hardware error — silently ignore
        }
      })();
    }

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
  }, [orderId]);
}
