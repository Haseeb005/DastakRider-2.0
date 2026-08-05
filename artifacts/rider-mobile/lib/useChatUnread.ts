/**
 * useChatUnread(orderId)
 *
 * Tracks the number of unread customer messages for a single order.
 * - Polls every POLL_MS and updates on WebSocket "change" events.
 * - Respects the chatBadgeStore "cleared at" watermark so badges clear the
 *   moment the rider opens the chat screen, even before the server confirms.
 *
 * Push notifications for new messages are handled at the tab-layout level
 * (useChatWatcher → onNewMessage) so they fire on every tab.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  setNotificationHandler,
  requestPermissionsAsync,
} from "@/lib/localPush";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { Platform } from "react-native";

import { TOKEN_KEY } from "./auth";
import {
  getClearedAt,
  getOpenChatOrderId,
  subscribe,
} from "./chatBadgeStore";

const CHAT_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000");
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
  setNotificationHandler({
    handleNotification: async () => ({
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
    const result = (await requestPermissionsAsync()) as {
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
      if (clearedAt > 0) {
        // If the message has a timestamp, only count it if it arrived after the
        // rider last closed the chat. Without a timestamp, assume it was seen.
        if (m.createdAt) return new Date(m.createdAt).getTime() > clearedAt;
        return false;
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

export function useChatUnread(orderId: string, customerName?: string): number {
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
        // Note: push notifications for new messages are fired at the tab-layout
        // level (useChatWatcher onNewMessage) so they work on every tab, not just
        // when this hook is mounted. This hook is responsible for badge counts only.
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
            if (msg.type === "change") {
              if (
                (msg.collection === "orders" && msg.id === orderId) ||
                msg.collection === "chats"
              ) {
                fetchAndUpdate();
              }
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
