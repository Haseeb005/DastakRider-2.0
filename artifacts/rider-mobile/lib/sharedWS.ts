import AsyncStorage from "@react-native-async-storage/async-storage";

import { TOKEN_KEY } from "./auth";

/**
 * Module-level singleton WebSocket for the live change feed.
 *
 * Multiple hooks (useOrderChat, useChatWatcher, useChatUnread) subscribe to
 * the same connection so there is never more than one open socket regardless
 * of how many components are mounted.
 */

function getWebSocketUrl(): string {
  // EXPO_PUBLIC_DOMAIN is injected by the dev command and every EAS build.
  // Prefer it over any local fallback so mobile always follows the deployment
  // domain used by the REST API.
  const domain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  if (domain) {
    const normalizedDomain = domain
      .replace(/^https?:\/\//i, "")
      .replace(/\/+$/, "");
    return `wss://${normalizedDomain}/api/ws/live`;
  }

  // Keep local development usable when the injected domain is unavailable.
  const apiUrl = (
    process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000"
  ).replace(/\/+$/, "");
  return `${apiUrl.replace(/^http/i, "ws")}/api/ws/live`;
}

const WS_URL = getWebSocketUrl();

type Listener = (event: MessageEvent) => void;

const listeners = new Set<Listener>();
let ws: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReconnect() {
  if (listeners.size === 0 || retryTimer !== null) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, 5_000);
}

function connect() {
  if (listeners.size === 0) return;
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  try {
    const socket = new WebSocket(WS_URL);
    ws = socket;

    socket.onopen = async () => {
      const token = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
      if (ws !== socket) return;
      if (!token) {
        socket.close(4401, "Authentication required");
        return;
      }
      socket.send(JSON.stringify({ type: "auth", token }));
    };

    socket.onmessage = (event) => {
      if (ws !== socket) return;
      listeners.forEach((fn) => {
        try {
          fn(event);
        } catch {}
      });
    };

    socket.onerror = () => {};

    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      scheduleReconnect();
    };
  } catch {
    scheduleReconnect();
  }
}

function maybeDisconnect() {
  if (listeners.size === 0) {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    const socket = ws;
    ws = null;
    socket?.close();
  }
}

/** Subscribe to all incoming WebSocket messages. Returns an unsubscribe fn. */
export function subscribeWS(listener: Listener): () => void {
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
    maybeDisconnect();
  };
}
