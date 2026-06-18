import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

/**
 * Plays a new-order alert. On web, an ascending arpeggio via Web Audio.
 * On native, a sequence of haptic pulses for ~15 seconds (Expo Go has no
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
      for (let cycle = 0; cycle < 24 && t < start + 15; cycle++) {
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
    if (count >= 25) clearInterval(id);
  }, 600);
  return () => clearInterval(id);
}

const AUTO_HIDE_MS = 12000;

/**
 * Tracks seen order IDs; seeds on first load (no alert), then alerts when new
 * orders appear while online. The banner auto-hides after a timeout, when the
 * rider accepts (clearNew), or when the new orders leave the available list.
 */
export function useOrderAlert(orders: { id: string }[], isOnline: boolean) {
  const seen = useRef<Set<string>>(new Set());
  const seeded = useRef(false);
  const stopRef = useRef<null | (() => void)>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [newIds, setNewIds] = useState<string[]>([]);

  const clearTimer = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const stopAlert = () => {
    if (stopRef.current) {
      stopRef.current();
      stopRef.current = null;
    }
  };

  useEffect(() => {
    if (!isOnline) {
      seeded.current = false;
      seen.current = new Set();
      stopAlert();
      clearTimer();
      // Return the same array when already empty so React bails out and we
      // don't loop on the new `[]` identity from `ordersQ.data ?? []`.
      setNewIds((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const presentIds = new Set(orders.map((o) => o.id));
    if (!seeded.current) {
      orders.forEach((o) => seen.current.add(o.id));
      seeded.current = true;
      return;
    }
    const fresh = orders
      .filter((o) => !seen.current.has(o.id))
      .map((o) => o.id);
    // Prune any previously-new orders that left the list (accepted by
    // someone, expired, …) and merge in the freshly arrived ones. Return the
    // previous array unchanged when the result is identical so React bails out
    // of the render instead of looping on a new array instance every poll.
    setNewIds((prev) => {
      const kept = prev.filter((id) => presentIds.has(id));
      const merged = Array.from(new Set([...kept, ...fresh]));
      const same =
        merged.length === prev.length &&
        merged.every((id, i) => id === prev[i]);
      return same ? prev : merged;
    });
    if (fresh.length > 0) {
      fresh.forEach((id) => seen.current.add(id));
      stopAlert();
      stopRef.current = playOrderAlert();
      clearTimer();
      hideTimer.current = setTimeout(() => {
        stopAlert();
        setNewIds([]);
      }, AUTO_HIDE_MS);
    }
  }, [orders, isOnline]);

  useEffect(() => {
    return () => {
      stopAlert();
      clearTimer();
    };
  }, []);

  const clearNew = () => {
    clearTimer();
    stopAlert();
    setNewIds([]);
  };

  return { newCount: newIds.length, clearNew, stopAlert };
}
