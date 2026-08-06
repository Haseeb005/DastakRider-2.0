import { useEffect, useRef, useState } from "react";

export interface RiderLocation {
  lat: number;
  lng: number;
  ts: number;
}

/**
 * Polls GET /api/orders/:orderId/rider-location every `intervalMs` ms.
 * Returns null when there is no recent location (404) or the order is not
 * in transit. Stops polling when `enabled` is false.
 */
export function useRiderLocation(orderId: string, enabled: boolean, intervalMs = 5000) {
  const [location, setLocation] = useState<RiderLocation | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch_ = useRef(async () => {
    try {
      const res = await fetch(`/api/orders/${orderId}/rider-location`);
      if (res.ok) {
        const data = await res.json();
        setLocation(data as RiderLocation);
      } else {
        setLocation(null);
      }
    } catch {
      // network error — keep last known position
    }
  });
  fetch_.current = async () => {
    try {
      const res = await fetch(`/api/orders/${orderId}/rider-location`);
      if (res.ok) {
        const data = await res.json();
        setLocation(data as RiderLocation);
      } else {
        setLocation(null);
      }
    } catch {}
  };

  useEffect(() => {
    if (!enabled) {
      setLocation(null);
      return;
    }
    fetch_.current();
    timer.current = setInterval(() => fetch_.current(), intervalMs);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [orderId, enabled, intervalMs]);

  return location;
}
