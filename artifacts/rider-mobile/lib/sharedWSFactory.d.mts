export type SharedWebSocketOptions = {
  url?: string;
  retryMs?: number;
  WebSocketImpl?: typeof WebSocket;
  getToken?: () => Promise<string | null>;
};

export type SharedWebSocket = {
  subscribe: (listener: (event: MessageEvent) => void) => () => void;
};

export function createSharedWebSocket(
  options?: SharedWebSocketOptions,
): SharedWebSocket;