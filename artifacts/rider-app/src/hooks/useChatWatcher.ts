/**
 * useChatWatcher — lightweight background chat monitor for the Active tab.
 *
 * Subscribes to the shared singleton WebSocket and refetches messages for any
 * active order whenever the server emits a change event for it. This means
 * chat state stays fresh even when the rider never opens the chat panel.
 *
 * When the rider DOES open the chat panel, useOrderChat subscribes to the
 * same singleton — no second connection is created.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeWS } from "./sharedWS";

// Empty base — calls are relative to the current origin, which the Replit
// shared proxy routes to the api-server.
const CHAT_BASE = "";
const TOKEN_STORAGE_KEY = "rider_chat_token";

function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export type ChatMessage = {
  id: string;
  fromRole: "rider" | "customer";
  text: string;
  time: string;
  createdAt?: string;
  read: boolean;
};

/**
 * @param orderIds       - List of active order IDs to watch.
 * @param onNewMessage   - Called with (orderId) when a new customer message
 *                         arrives for that order. Store in a ref on the
 *                         caller side to avoid dependency-array churn.
 * @returns messagesByOrderId - Latest messages keyed by order ID.
 */
export function useChatWatcher(
  orderIds: string[],
  onNewMessage?: (orderId: string) => void,
) {
  const [messagesByOrderId, setMessagesByOrderId] = useState<
    Record<string, ChatMessage[]>
  >({});

  // Keep a ref so the WS listener always sees the latest order IDs without
  // needing to re-subscribe every time the list changes.
  const orderIdsRef = useRef<string[]>(orderIds);
  orderIdsRef.current = orderIds;

  // Store callback in a ref so it never needs to be in a dependency array.
  const onNewMessageRef = useRef(onNewMessage);
  onNewMessageRef.current = onNewMessage;

  // Track seen customer-message IDs per order so we can detect new arrivals.
  // seededOrders: orders whose initial snapshot has been captured (no alert on
  // first load — only on genuinely new messages that arrive later).
  const seenMsgIds = useRef<Record<string, Set<string>>>({});
  const seededOrders = useRef<Set<string>>(new Set());

  const fetchForOrder = useCallback(async (orderId: string) => {
    try {
      const token = getToken();
      const res = await fetch(`${CHAT_BASE}/api/orders/${orderId}/chat`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const data = await res.json();
      const msgs: ChatMessage[] = Array.isArray(data)
        ? data
        : (data.messages ?? []);

      setMessagesByOrderId((prev) => ({ ...prev, [orderId]: msgs }));

      // Detect new customer messages after the first snapshot.
      const customerMsgs = msgs.filter((m) => m.fromRole === "customer");
      const seen = seenMsgIds.current[orderId] ?? new Set<string>();

      if (!seededOrders.current.has(orderId)) {
        // First fetch: just record what already exists, no alert.
        seededOrders.current.add(orderId);
        seenMsgIds.current[orderId] = new Set(customerMsgs.map((m) => m.id));
      } else {
        const newOnes = customerMsgs.filter((m) => !seen.has(m.id));
        if (newOnes.length > 0) {
          newOnes.forEach((m) => seen.add(m.id));
          seenMsgIds.current[orderId] = seen;
          onNewMessageRef.current?.(orderId);
        }
      }
    } catch {
      // network error — leave previous messages intact
    }
  }, []);

  // Initial fetch whenever the order list changes.
  useEffect(() => {
    orderIds.forEach((id) => fetchForOrder(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderIds.join(","), fetchForOrder]);

  // Subscribe to the shared WS once; re-use the existing connection if
  // useOrderChat (chat panel) is also subscribed.
  // Handle both "orders" and "chats" collection change events.
  useEffect(() => {
    const unsubscribe = subscribeWS((event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "change") {
          if (
            msg.collection === "orders" &&
            orderIdsRef.current.includes(msg.id)
          ) {
            fetchForOrder(msg.id);
          } else if (msg.collection === "chats") {
            // We don't know which order changed; refetch all watched orders.
            orderIdsRef.current.forEach((id) => fetchForOrder(id));
          }
        }
      } catch {}
    });
    return unsubscribe;
  }, [fetchForOrder]);

  // Polling fallback so messages surface even without a WS broadcast.
  useEffect(() => {
    if (orderIds.length === 0) return;
    const interval = setInterval(() => {
      orderIdsRef.current.forEach((id) => fetchForOrder(id));
    }, 10_000);
    return () => clearInterval(interval);
  }, [orderIds.length, fetchForOrder]);

  return { messagesByOrderId };
}
