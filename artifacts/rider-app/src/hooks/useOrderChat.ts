import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeWS } from "./sharedWS";

// Empty base — calls are relative to the current origin, which the Replit
// shared proxy routes to the api-server.
const CHAT_BASE = "";
const TOKEN_STORAGE_KEY = "rider_chat_token";

export type ChatMessage = {
  id: string;
  fromRole: "rider" | "customer";
  text: string;
  time: string;
  createdAt?: string;
  read: boolean;
};

export function saveRiderChatToken(token: string) {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {}
}

function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function useOrderChat(orderId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const mountedRef = useRef(true);

  const fetchMessages = useCallback(async () => {
    if (!orderId) return;
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
      if (mountedRef.current) setMessages(msgs);
    } catch {
      // network error — leave previous messages intact
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [orderId]);

  const sendMessage = useCallback(
    async (text: string): Promise<boolean> => {
      if (!orderId) return false;
      setSending(true);
      try {
        const token = getToken();
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
    if (!orderId) {
      setLoading(false);
      return;
    }

    mountedRef.current = true;
    setLoading(true);
    setMessages([]);
    fetchMessages();

    // Subscribe to the shared singleton WebSocket — no new connection is
    // opened if useChatWatcher is already running on the Active tab.
    // Fire on "orders" changes for this order OR any "chats" collection change
    // (DastakMart may broadcast either collection when a message is sent).
    const unsubscribe = subscribeWS((event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "change") {
          if (msg.collection === "orders" && msg.id === orderId) {
            fetchMessages();
          } else if (msg.collection === "chats") {
            fetchMessages();
          }
        }
      } catch {}
    });

    // Polling fallback — ensures messages appear even if the WebSocket misses
    // the event (e.g. the customer app writes to a different WS channel).
    const poll = setInterval(fetchMessages, 8_000);

    return () => {
      mountedRef.current = false;
      unsubscribe();
      clearInterval(poll);
    };
  }, [orderId, fetchMessages]);

  return { messages, loading, sending, sendMessage, refetch: fetchMessages };
}
