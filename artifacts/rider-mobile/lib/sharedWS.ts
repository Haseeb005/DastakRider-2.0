import AsyncStorage from "@react-native-async-storage/async-storage";

import { TOKEN_KEY } from "./auth";
import {
  createSharedWebSocket,
  type SharedWebSocketOptions,
} from "./sharedWSFactory.mjs";

export { createSharedWebSocket, type SharedWebSocketOptions };

/**
 * Module-level singleton WebSocket for the live change feed.
 *
 * Multiple hooks (useOrderChat, useChatWatcher, useChatUnread) subscribe to
 * the same connection so there is never more than one open socket regardless
 * of how many components are mounted.
 */

function getWebSocketUrl(): string {
  // EAS builds provide EXPO_PUBLIC_DOMAIN. Local development uses the
  // published API URL from EXPO_PUBLIC_API_URL, keeping REST and WebSocket
  // traffic on the same host.
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

const sharedWebSocket = createSharedWebSocket({
  url: WS_URL,
  getToken: () => AsyncStorage.getItem(TOKEN_KEY).catch(() => null),
});

/** Subscribe to all incoming WebSocket messages. Returns an unsubscribe fn. */
export function subscribeWS(listener: Listener): () => void {
  return sharedWebSocket.subscribe(listener);
}
