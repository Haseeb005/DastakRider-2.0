import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

// The looping ringtone played on native when a new order arrives.
const ORDER_TONE = require("../assets/sounds/new-order.wav");

// Configure the native audio session once so the tone rings even when the
// phone is on silent (iOS) and routes through the speaker.
let audioModeReady = false;
function ensureAudioMode() {
  if (audioModeReady) return;
  setAudioModeAsync({ playsInSilentMode: true })
    .then(() => {
      audioModeReady = true;
    })
    .catch(() => {});
}

// ─── Singleton native player ───────────────────────────────────────────────
// We keep ONE player instance for the lifetime of the app. Reusing it instead
// of calling createAudioPlayer() on every new order prevents two overlapping
// audio tracks (the old instance wouldn't always stop in time on Android).
let _player: ReturnType<typeof createAudioPlayer> | null = null;

function getNativePlayer() {
  if (!_player) {
    try {
      ensureAudioMode();
      _player = createAudioPlayer(ORDER_TONE);
      _player.loop = true;
      _player.volume = 1;
    } catch {
      _player = null;
    }
  }
  return _player;
}

function startNativePlayer() {
  const p = getNativePlayer();
  if (!p) return;
  try {
    // Seek back to start so overlapping calls always replay from the beginning.
    p.seekTo(0);
    p.play();
  } catch {}
}

function stopNativePlayer() {
  if (!_player) return;
  try {
    // pause() is guaranteed to silence playback on Android; remove() alone is not.
    _player.pause();
  } catch {}
}
// ──────────────────────────────────────────────────────────────────────────

/**
 * Plays a new-order alert. On web, an ascending arpeggio via Web Audio.
 * On native, a looping ringtone (singleton expo-audio player) + haptics.
 * Returns a stop function.
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

  // Native: single shared player — no duplicate tracks possible.
  startNativePlayer();

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

  return () => {
    clearInterval(id);
    stopNativePlayer();
  };
}

/**
 * Tracks seen order IDs; seeds on first load (no alert), then alerts when new
 * orders appear while online. The tune stops when the rider accepts (clearNew)
 * or when all alerted orders leave the available list (taken by another rider).
 * There is no auto-hide timer — the banner stays until one of those two events.
 */
export function useOrderAlert(orders: { id: string }[], isOnline: boolean) {
  const seen = useRef<Set<string>>(new Set());
  const seeded = useRef(false);
  const stopRef = useRef<null | (() => void)>(null);
  const [newIds, setNewIds] = useState<string[]>([]);
  // Mirror of newIds as a ref so the effect can read current state synchronously
  // without adding newIds to the dependency array (which would cause loops).
  const newIdsRef = useRef<string[]>([]);

  const updateNewIds = (next: string[]) => {
    newIdsRef.current = next;
    setNewIds(next);
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
      if (newIdsRef.current.length > 0) updateNewIds([]);
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

    if (fresh.length > 0) {
      // New order(s) arrived — update list and start the tune.
      fresh.forEach((id) => seen.current.add(id));
      const kept = newIdsRef.current.filter((id) => presentIds.has(id));
      const merged = Array.from(new Set([...kept, ...fresh]));
      updateNewIds(merged);
      stopAlert();
      stopRef.current = playOrderAlert();
    } else {
      // No new orders — prune ids that left the list.
      const kept = newIdsRef.current.filter((id) => presentIds.has(id));
      if (kept.length !== newIdsRef.current.length) {
        // Some alerted orders disappeared (accepted by another rider).
        if (kept.length === 0) {
          // All gone — silence the tune immediately.
          stopAlert();
        }
        updateNewIds(kept);
      }
    }
  }, [orders, isOnline]);

  useEffect(() => {
    return () => {
      stopAlert();
    };
  }, []);

  const clearNew = () => {
    stopAlert();
    updateNewIds([]);
  };

  return { newCount: newIds.length, clearNew, stopAlert };
}
