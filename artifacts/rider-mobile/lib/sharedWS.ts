/**
 * Module-level singleton WebSocket for wss://dastakbites.com/ws/live.
 *
 * Multiple hooks (useOrderChat, useChatWatcher) subscribe to the same
 * connection so there is never more than one open socket regardless of how
 * many components are mounted.
 */

const WS_URL = "wss://dastakbites.com/ws/live";

type Listener = (event: MessageEvent) => void;

const listeners = new Set<Listener>();
let ws: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let intentionalClose = false;

function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }
  intentionalClose = false;
  try {
    ws = new WebSocket(WS_URL);

    ws.onmessage = (event) => {
      listeners.forEach((fn) => {
        try {
          fn(event);
        } catch {}
      });
    };

    ws.onerror = () => {};

    ws.onclose = () => {
      ws = null;
      if (!intentionalClose && listeners.size > 0) {
        retryTimer = setTimeout(connect, 5_000);
      }
    };
  } catch {}
}

function maybeDisconnect() {
  if (listeners.size === 0) {
    intentionalClose = true;
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    ws?.close();
    ws = null;
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
