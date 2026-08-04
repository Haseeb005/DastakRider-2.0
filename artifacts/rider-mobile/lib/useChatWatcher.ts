/**
 * useChatWatcher — lightweight background chat monitor for the Active tab.
 *
 * Subscribes to the shared singleton WebSocket and refetches messages for any
 * active order whenever the server emits a change event for it. This means
 * chat state stays fresh even when the rider never opens the chat screen.
 *
 * When the rider DOES open the chat screen, useOrderChat subscribes to the
 * same singleton — no second connection is created.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { TOKEN_KEY } from "./auth";
import { subscribeWS } from "./sharedWS";

// Resolve the api-server base URL the same way the rest of the mobile app does.
const CHAT_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000");

export type ChatMessage = {
  id: string;
  fromRole: "rider" | "customer";
  text: string;
  time: string;
  createdAt?: string;
  read: boolean;
};

/**
 * @param orderIds - List of active order IDs to watch.
 * @returns messagesByOrderId - Latest messages keyed by order ID, updated
 *   whenever the server reports a change for any watched order.
 */
export function useChatWatcher(orderIds: string[]) {
  const [messagesByOrderId, setMessagesByOrderId] = useState<
    Record<string, ChatMessage[]>
  >({});

  // Keep a ref so the WS listener always sees the latest order IDs without
  // needing to re-subscribe every time the list changes.
  const orderIdsRef = useRef<string[]>(orderIds);
  orderIdsRef.current = orderIds;

  const fetchForOrder = useCallback(async (orderId: string) => {
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const res = await fetch(`${CHAT_BASE}/api/orders/${orderId}/chat`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const data = await res.json();
      const msgs: ChatMessage[] = Array.isArray(data)
        ? data
        : (data.messages ?? []);
      setMessagesByOrderId((prev) => ({ ...prev, [orderId]: msgs }));
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
  // useOrderChat (chat screen) is also subscribed.
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
            // Refetch all watched orders — we don't have the orderId from the chat doc ID.
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
