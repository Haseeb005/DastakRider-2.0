/**
 * useChatUnread(orderId)
 *
 * Tracks the number of unread customer messages for a single order.
 * - Polls every POLL_MS and updates on WebSocket "change" events.
 * - Fires a local expo-notifications push when the count increases and the
 *   chat screen for this order is not currently open.
 * - Respects the chatBadgeStore "cleared at" watermark so badges clear the
 *   moment the rider opens the chat screen, even before the server confirms.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { Platform } from "react-native";

import { TOKEN_KEY } from "./auth";
import {
  getClearedAt,
  getOpenChatOrderId,
  subscribe,
} from "./chatBadgeStore";

const CHAT_BASE = "https://dastakbites.com";
const WS_URL = "wss://dastakbites.com/ws/live";
const POLL_MS = 15_000;

type RawMessage = {
  id: string;
  fromRole: "rider" | "customer";
  createdAt?: string;
  read: boolean;
};

// Configure how notifications are handled while the app is foregrounded.
// Call this once on app start (idempotent).
let notifHandlerSet = false;
export function ensureNotificationHandler() {
  if (notifHandlerSet) return;
  notifHandlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/** Request permission once; resolves to true if granted. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    // requestPermissionsAsync is safe to call repeatedly — it returns the
    // current grant status without re-prompting if already decided.
    const result = (await Notifications.requestPermissionsAsync()) as {
      ios?: { status?: number };
      canAskAgain?: boolean;
    } & Record<string, unknown>;
    // The permission is granted when the native module returns status = 3
    // (UNAuthorizationStatusAuthorized on iOS) or canAskAgain is false and
    // not denied — simplest cross-platform check: just see if the cast object
    // has anything that indicates denial.
    // Fall back: if no useful field is present, assume granted.
    const status = (result as any).status ?? (result?.ios as any)?.status;
    if (typeof status === "string") return status === "granted";
    if (typeof status === "number") return status === 3; // iOS granted = 3
    return true; // unknown — optimistically assume granted
  } catch {
    return false;
  }
}

/**
 * Count how many customer messages are "unread" from the rider's perspective.
 *
 * A message is considered unread when ALL of:
 *   1. fromRole === "customer"
 *   2. server field read === false  (the server has it flagged as unread)
 *   3. it arrived after the last time the rider opened this order's chat
 *      (if createdAt is present and clearedAt > 0)
 */
function countUnread(msgs: RawMessage[], clearedAt: number): number {
  return msgs.filter((m) => {
    if (m.fromRole !== "customer") return false;
    if (!m.read) {
      if (clearedAt > 0 && m.createdAt) {
        return new Date(m.createdAt).getTime() > clearedAt;
      }
      return true;
    }
    return false;
  }).length;
}

// Throttle: only one notification per order per NOTIF_THROTTLE_MS window.
// Prevents burst alerts when both a WS event and a poll land within seconds.
const notifThrottleByOrder = new Map<string, number>();
const NOTIF_THROTTLE_MS = 5_000;

export function useChatUnread(orderId: string): number {
  // Force a re-render when chatBadgeStore notifies us (chat open/close).
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribe(rerender), []);

  // seededRef: true once the first fetch has established the baseline.
  // We never notify on the first fetch — that count represents pre-existing
  // unread messages the rider may have already seen, not new arrivals.
  const seededRef = useRef(false);
  const prevCountRef = useRef(0);
  const mountedRef = useRef(true);

  // Keep the latest fetched count in a ref so the render can return it
  // without storing it in useState (avoids double renders).
  const latestCountRef = useRef(0);

  const fetchAndUpdate = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const res = await fetch(`${CHAT_BASE}/api/orders/${orderId}/chat`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const data = await res.json();
      const msgs: RawMessage[] = Array.isArray(data)
        ? data
        : (data.messages ?? []);

      if (!mountedRef.current) return;

      const clearedAt = getClearedAt(orderId);
      const count = countUnread(msgs, clearedAt);

      if (!seededRef.current) {
        // First fetch: establish the baseline silently — no notification.
        seededRef.current = true;
      } else if (
        Platform.OS !== "web" &&
        count > prevCountRef.current &&
        getOpenChatOrderId() !== orderId
      ) {
        // Subsequent fetches: notify only when the count genuinely increased
        // and the rider is not already in this order's chat screen.
        // Throttle per order to avoid duplicate alerts from WS + poll bursts.
        const lastNotif = notifThrottleByOrder.get(orderId) ?? 0;
        if (Date.now() - lastNotif > NOTIF_THROTTLE_MS) {
          notifThrottleByOrder.set(orderId, Date.now());
          const delta = count - prevCountRef.current;
          Notifications.scheduleNotificationAsync({
            content: {
              title: "New message from customer",
              body:
                delta === 1
                  ? "The customer sent you a message"
                  : `${delta} new messages from the customer`,
              sound: true,
            },
            trigger: null, // fire immediately
          }).catch(() => {});
        }
      }

      prevCountRef.current = count;
      latestCountRef.current = count;
      rerender();
    } catch {
      // network error — leave previous count intact
    }
  }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current = true;
    seededRef.current = false;
    latestCountRef.current = 0;
    prevCountRef.current = 0;
    fetchAndUpdate();

    const pollId = setInterval(fetchAndUpdate, POLL_MS);

    let ws: WebSocket;
    let retryTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      try {
        ws = new WebSocket(WS_URL);
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string);
            if (
              msg.type === "change" &&
              msg.collection === "orders" &&
              msg.id === orderId
            ) {
              fetchAndUpdate();
            }
          } catch {}
        };
        ws.onerror = () => {};
        ws.onclose = () => {
          if (mountedRef.current) retryTimeout = setTimeout(connect, 5_000);
        };
      } catch {}
    }

    connect();

    return () => {
      mountedRef.current = false;
      clearInterval(pollId);
      clearTimeout(retryTimeout);
      ws?.close();
    };
  }, [orderId, fetchAndUpdate]);

  // If this order's chat is open, always show 0.
  if (getOpenChatOrderId() === orderId) return 0;
  return latestCountRef.current;
}
