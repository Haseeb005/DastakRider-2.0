import { useCallback, useEffect, useRef, useState } from "react";

const CHAT_BASE = "https://dastakbites.com";
const WS_URL = "wss://dastakbites.com/ws/live";
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
  const wsRef = useRef<WebSocket | null>(null);
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

    let ws: WebSocket;
    let retryTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      try {
        ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onmessage = (event) => {
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
        };

        ws.onerror = () => {};
        ws.onclose = () => {
          if (mountedRef.current) {
            retryTimeout = setTimeout(connect, 5_000);
          }
        };
      } catch {}
    }

    connect();

    return () => {
      mountedRef.current = false;
      clearTimeout(retryTimeout);
      wsRef.current?.close();
    };
  }, [orderId, fetchMessages]);

  return { messages, loading, sending, sendMessage, refetch: fetchMessages };
}
