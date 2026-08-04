import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { TOKEN_KEY } from "./auth";
import { subscribeWS } from "./sharedWS";

const CHAT_BASE = "https://dastakbites.com";

export type ChatMessage = {
  id: string;
  fromRole: "rider" | "customer";
  text: string;
  time: string;
  createdAt?: string;
  read: boolean;
};

export function useOrderChat(orderId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const mountedRef = useRef(true);

  const fetchMessages = useCallback(async () => {
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
      if (mountedRef.current) setMessages(msgs);
    } catch {
      // network error — leave previous messages intact
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [orderId]);

  const sendMessage = useCallback(
    async (text: string): Promise<boolean> => {
      setSending(true);
      try {
        const token = await AsyncStorage.getItem(TOKEN_KEY);
        const res = await fetch(`${CHAT_BASE}/api/orders/${orderId}/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) return false;
        await fetchMessages();
        return true;
      } catch {
        return false;
      } finally {
        if (mountedRef.current) setSending(false);
      }
    },
    [orderId, fetchMessages],
  );

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    setMessages([]);
    fetchMessages();

    // Subscribe to the shared singleton WebSocket — no new connection is
    // opened if useChatWatcher is already running on the Active tab.
    const unsubscribe = subscribeWS((event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (
          msg.type === "change" &&
          msg.collection === "orders" &&
          msg.id === orderId
        ) {
          fetchMessages();
        }
      } catch {}
    });

    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [orderId, fetchMessages]);

  return { messages, loading, sending, sendMessage, refetch: fetchMessages };
}
