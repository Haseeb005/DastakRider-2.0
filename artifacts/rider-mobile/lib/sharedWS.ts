import AsyncStorage from "@react-native-async-storage/async-storage";

import { API_WEBSOCKET_URL } from "./apiBase";
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

type Listener = (event: MessageEvent) => void;

const sharedWebSocket = createSharedWebSocket({
  url: API_WEBSOCKET_URL,
  getToken: () => AsyncStorage.getItem(TOKEN_KEY).catch(() => null),
});

/** Subscribe to all incoming WebSocket messages. Returns an unsubscribe fn. */
export function subscribeWS(listener: Listener): () => void {
  return sharedWebSocket.subscribe(listener);
}
