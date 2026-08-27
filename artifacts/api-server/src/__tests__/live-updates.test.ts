import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";

import {
  startLiveUpdateServer,
  type LiveUpdateServer,
} from "../lib/liveUpdates.js";
import { signRiderToken } from "../lib/riderToken.js";

type Change = {
  ns: { coll: string };
  documentKey: { _id: string };
};

class FakeChangeStream extends EventEmitter {
  closed = false;

  async close(): Promise<void> {
    this.closed = true;
  }

  emitChange(collection: "orders" | "chats", id: string): void {
    this.emit("change", {
      ns: { coll: collection },
      documentKey: { _id: id },
    } satisfies Change);
  }
}

function waitFor<T>(
  event: (resolve: (value: T) => void, reject: (error: Error) => void) => void,
  timeoutMs = 1_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    event(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  return waitFor<void>((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (predicate()) {
        resolve();
      } else if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Condition was not met after ${timeoutMs}ms`));
      } else {
        setTimeout(check, 1);
      }
    };
    check();
  }, timeoutMs);
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return waitFor<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitForClose(socket: WebSocket): Promise<number> {
  return waitFor<number>((resolve) => {
    socket.once("close", (code) => resolve(code));
  });
}

function waitForMessage(
  socket: WebSocket,
  predicate: (message: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return waitFor<Record<string, unknown>>((resolve) => {
    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      if (predicate(message)) {
        socket.off("message", onMessage);
        resolve(message);
      }
    };
    socket.on("message", onMessage);
  });
}

function connectClient(port: number): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/api/ws/live`);
}

describe("rider live update WebSocket", () => {
  let server: Server;
  let liveServer: LiveUpdateServer;
  let stream: FakeChangeStream;
  let streams: FakeChangeStream[];
  let port: number;
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    streams = [];
    stream = new FakeChangeStream();
    streams.push(stream);
    server = createServer();
    liveServer = startLiveUpdateServer(server, {
      watchChanges: () => {
        const next = streams[streams.length - 1]!;
        return next as never;
      },
      resolveRiderForChange: async (collection, id) => {
        const assignments: Record<string, string> = {
          "order-own": "rider-own",
          "order-other": "rider-other",
          "chat-own": "rider-own",
          "chat-other": "rider-other",
        };
        const expectedPrefix = collection === "orders" ? "order-" : "chat-";
        return id.startsWith(expectedPrefix) ? assignments[id] ?? null : null;
      },
      retryMs: 10,
      authTimeoutMs: 20,
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.removeAllListeners();
      if (socket.readyState === WebSocket.OPEN) socket.close();
    }
    await liveServer.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("rejects missing authentication after the handshake timeout", async () => {
    const socket = connectClient(port);
    sockets.push(socket);
    await waitForOpen(socket);

    assert.equal(await waitForClose(socket), 4401);
  });

  it("rejects invalid authentication immediately", async () => {
    const socket = connectClient(port);
    sockets.push(socket);
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "auth", token: "not-a-valid-token" }));

    assert.equal(await waitForClose(socket), 4401);
  });

  it("delivers matching order and chat changes only to the assigned rider", async () => {
    const own = connectClient(port);
    const other = connectClient(port);
    sockets.push(own, other);
    await Promise.all([waitForOpen(own), waitForOpen(other)]);

    own.send(JSON.stringify({ type: "auth", token: signRiderToken("rider-own") }));
    other.send(
      JSON.stringify({ type: "auth", token: signRiderToken("rider-other") }),
    );
    await Promise.all([
      waitForMessage(own, (message) => message.type === "authenticated"),
      waitForMessage(other, (message) => message.type === "authenticated"),
    ]);

    const ownMessages: Record<string, unknown>[] = [];
    const otherMessages: Record<string, unknown>[] = [];
    own.on("message", (data) => ownMessages.push(JSON.parse(data.toString())));
    other.on("message", (data) =>
      otherMessages.push(JSON.parse(data.toString())),
    );

    stream.emitChange("orders", "order-own");
    stream.emitChange("orders", "order-other");
    stream.emitChange("chats", "chat-own");
    stream.emitChange("chats", "chat-other");
    await waitUntil(
      () =>
        ownMessages.filter((message) => message.type === "change").length === 2 &&
        otherMessages.filter((message) => message.type === "change").length === 2,
    );

    assert.deepEqual(
      ownMessages.filter((message) => message.type === "change"),
      [
        { type: "change", collection: "orders", id: "order-own" },
        { type: "change", collection: "chats", id: "chat-own" },
      ],
    );
    assert.deepEqual(
      otherMessages.filter((message) => message.type === "change"),
      [
        { type: "change", collection: "orders", id: "order-other" },
        { type: "change", collection: "chats", id: "chat-other" },
      ],
    );
  });

  it("reconnects the change stream and continues broadcasting after an error", async () => {
    const socket = connectClient(port);
    sockets.push(socket);
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "auth", token: signRiderToken("rider-own") }));
    await waitForMessage(socket, (message) => message.type === "authenticated");

    const replacement = new FakeChangeStream();
    streams.push(replacement);
    stream.emit("error", new Error("temporary change stream failure"));
    await waitUntil(() => replacement.listenerCount("change") > 0, 500);

    replacement.emitChange("orders", "order-own");
    const message = await waitForMessage(
      socket,
      (candidate) => candidate.type === "change",
    );
    assert.deepEqual(message, {
      type: "change",
      collection: "orders",
      id: "order-own",
    });
    assert.equal(stream.closed, true);
  });
});