export function createSharedWebSocket(options = {}) {
  const Socket =
    options.WebSocketImpl ??
    (typeof WebSocket === "undefined" ? null : WebSocket);
  const url = options.url ?? "";
  const retryMs = options.retryMs ?? 5_000;
  const getToken = options.getToken ?? (async () => null);
  const listeners = new Set();
  let ws = null;
  let retryTimer = null;

  function scheduleReconnect() {
    if (listeners.size === 0 || retryTimer !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, retryMs);
  }

  function connect() {
    if (listeners.size === 0) return;
    if (!Socket) {
      scheduleReconnect();
      return;
    }
    if (
      ws &&
      (ws.readyState === Socket.CONNECTING || ws.readyState === Socket.OPEN)
    ) {
      return;
    }

    try {
      const socket = new Socket(url);
      ws = socket;

      socket.onopen = async () => {
        const token = await getToken();
        if (ws !== socket) return;
        if (!token) {
          socket.close(4401, "Authentication required");
          return;
        }
        socket.send(JSON.stringify({ type: "auth", token }));
      };

      socket.onmessage = (event) => {
        if (ws !== socket) return;
        listeners.forEach((listener) => {
          try {
            listener(event);
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
    if (listeners.size !== 0) return;
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    const socket = ws;
    ws = null;
    socket?.close();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      connect();
      return () => {
        listeners.delete(listener);
        maybeDisconnect();
      };
    },
  };
}