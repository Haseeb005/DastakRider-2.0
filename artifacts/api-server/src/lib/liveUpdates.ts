import type { Server } from "node:http";
import { ObjectId, type ChangeStream } from "mongodb";
import { WebSocket, WebSocketServer } from "ws";

import { logger } from "./logger";
import { chatsCol, ordersCol, watchLiveChanges } from "./mongo";
import { verifyRiderToken } from "./riderToken";

const RETRY_MS = 5_000;
const AUTH_TIMEOUT_MS = 10_000;

type LiveCollection = "orders" | "chats";

export type LiveUpdateServerOptions = {
  watchChanges?: () => ChangeStream;
  resolveRiderForChange?: (
    collection: LiveCollection,
    id: string,
  ) => Promise<string | null>;
  verifyToken?: (token: string) => string | null;
  retryMs?: number;
  authTimeoutMs?: number;
};

export type LiveUpdateServer = {
  close: () => Promise<void>;
};

export function startLiveUpdateServer(
  server: Server,
  options: LiveUpdateServerOptions = {},
): LiveUpdateServer {
  const wss = new WebSocketServer({
    server,
    path: "/api/ws/live",
  });

  const retryMs = options.retryMs ?? RETRY_MS;
  const authTimeoutMs = options.authTimeoutMs ?? AUTH_TIMEOUT_MS;
  const watchChanges = options.watchChanges ?? watchLiveChanges;
  const verifyToken = options.verifyToken ?? verifyRiderToken;
  let changeStream: ChangeStream | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const authenticatedRiders = new WeakMap<WebSocket, string>();

  async function defaultRiderForChange(
    collection: LiveCollection,
    id: string,
  ): Promise<string | null> {
    const documentId = ObjectId.isValid(id) ? new ObjectId(id) : id;
    if (collection === "orders") {
      const order = await ordersCol().findOne(
        { _id: documentId } as any,
        { projection: { riderId: 1 } },
      );
      return order?.riderId ? String(order.riderId) : null;
    }

    const chat = await chatsCol().findOne(
      { _id: documentId } as any,
      { projection: { riderId: 1, orderId: 1 } },
    );
    if (chat?.riderId) return String(chat.riderId);
    if (!chat?.orderId || !ObjectId.isValid(String(chat.orderId))) return null;

    const order = await ordersCol().findOne(
      { _id: new ObjectId(String(chat.orderId)) } as any,
      { projection: { riderId: 1 } },
    );
    return order?.riderId ? String(order.riderId) : null;
  }

  const riderForChange =
    options.resolveRiderForChange ?? defaultRiderForChange;

  async function broadcast(collection: LiveCollection, id: string): Promise<void> {
    const riderId = await riderForChange(collection, id);
    if (!riderId) return;

    const payload = JSON.stringify({ type: "change", collection, id });
    for (const client of wss.clients) {
      if (
        client.readyState === WebSocket.OPEN &&
        authenticatedRiders.get(client) === riderId
      ) {
        client.send(payload);
      }
    }
  }

  function scheduleReconnect(error?: unknown): void {
    if (stopped || retryTimer !== null) return;

    if (error) {
      logger.warn(
        { err: String(error) },
        "Live update change stream disconnected",
      );
    }

    const previousStream = changeStream;
    changeStream = null;
    previousStream?.removeAllListeners();
    previousStream?.close().catch(() => {});

    retryTimer = setTimeout(() => {
      retryTimer = null;
      connectChangeStream();
    }, retryMs);
  }

  function connectChangeStream(): void {
    if (stopped) return;
    try {
      const stream = watchChanges();
      changeStream = stream;

      stream.on("change", (change) => {
        if (!("ns" in change) || !("documentKey" in change)) return;

        const collection = change.ns.coll;
        const documentId = change.documentKey._id;
        if (
          (collection === "orders" || collection === "chats") &&
          documentId !== undefined
        ) {
          broadcast(collection, String(documentId)).catch((error) => {
            logger.warn(
              { err: String(error), collection, documentId: String(documentId) },
              "Failed to resolve live update recipient",
            );
          });
        }
      });
      stream.once("error", scheduleReconnect);
      stream.once("close", () => scheduleReconnect());
      logger.info("Live update change stream connected");
    } catch (error) {
      scheduleReconnect(error);
    }
  }

  wss.on("connection", (client) => {
    const authTimeout = setTimeout(() => {
      if (!authenticatedRiders.has(client)) {
        client.close(4401, "Authentication required");
      }
    }, authTimeoutMs);

    client.on("message", (data) => {
      if (authenticatedRiders.has(client)) return;
      try {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        const riderId =
          message.type === "auth" && typeof message.token === "string"
            ? verifyToken(message.token)
            : null;
        if (!riderId) {
          client.close(4401, "Invalid authentication");
          return;
        }
        authenticatedRiders.set(client, riderId);
        clearTimeout(authTimeout);
        client.send(JSON.stringify({ type: "authenticated" }));
        logger.info(
          { riderId, clientCount: wss.clients.size },
          "Live update client authenticated",
        );
      } catch {
        client.close(4400, "Invalid message");
      }
    });
    client.once("close", () => clearTimeout(authTimeout));
  });
  wss.on("error", (error) => {
    logger.error({ err: String(error) }, "Live update WebSocket server error");
  });

  connectChangeStream();

  return {
    close: async () => {
      stopped = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      const stream = changeStream;
      changeStream = null;
      stream?.removeAllListeners();
      if (stream) await stream.close().catch(() => {});
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    },
  };
}
