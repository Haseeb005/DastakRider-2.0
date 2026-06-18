import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

/**
 * Plays a new-order alert. On web, an ascending arpeggio via Web Audio.
 * On native, a sequence of haptic pulses for ~10 seconds (Expo Go has no
 * tone-synthesis API). Returns a stop function.
 */
export function playOrderAlert(): () => void {
  if (Platform.OS === "web") {
    try {
      const AC =
        (globalThis as any).AudioContext ||
        (globalThis as any).webkitAudioContext;
      if (!AC) return () => {};
      const ctx = new AC();
      const melody = [659, 784, 988, 1319];
      const start = ctx.currentTime;
      let t = start;
      for (let cycle = 0; cycle < 14 && t < start + 10; cycle++) {
        melody.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = freq;
          osc.type = i % 2 === 0 ? "triangle" : "sine";
          const dur = i === 3 ? 0.2 : 0.1;
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          osc.connect(gain).connect(ctx.destination);
          osc.start(t);
          osc.stop(t + dur);
          t += dur;
        });
        t += 0.15;
      }
      return () => {
        ctx.close().catch(() => {});
      };
    } catch {
      return () => {};
    }
  }

  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
    () => {},
  );
  let count = 0;
  const id = setInterval(() => {
    count++;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
      () => {},
    );
    if (count >= 16) clearInterval(id);
  }, 600);
  return () => clearInterval(id);
}

/**
 * Tracks seen order IDs; seeds on first load (no alert), then alerts when new
 * orders appear while online. Mirrors the web app's useOrderAlert.
 */
export function useOrderAlert(orders: { id: string }[], isOnline: boolean) {
  const seen = useRef<Set<string>>(new Set());
  const seeded = useRef(false);
  const stopRef = useRef<null | (() => void)>(null);
  const [newCount, setNewCount] = useState(0);

  useEffect(() => {
    if (!isOnline) {
      seeded.current = false;
      seen.current = new Set();
      if (stopRef.current) {
        stopRef.current();
        stopRef.current = null;
      }
      setNewCount(0);
      return;
    }
    if (!seeded.current) {
      orders.forEach((o) => seen.current.add(o.id));
      seeded.current = true;
      return;
    }
    const fresh = orders.filter((o) => !seen.current.has(o.id));
    if (fresh.length > 0) {
      fresh.forEach((o) => seen.current.add(o.id));
      setNewCount((c) => c + fresh.length);
      if (stopRef.current) stopRef.current();
      stopRef.current = playOrderAlert();
    }
  }, [orders, isOnline]);

  useEffect(() => {
    return () => {
      if (stopRef.current) stopRef.current();
    };
  }, []);

  const stopAlert = () => {
    if (stopRef.current) {
      stopRef.current();
      stopRef.current = null;
    }
  };

  const clearNew = () => {
    setNewCount(0);
    stopAlert();
  };

  return { newCount, clearNew, stopAlert };
}
