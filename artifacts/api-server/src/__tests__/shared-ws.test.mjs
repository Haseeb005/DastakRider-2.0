import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createSharedWebSocket } from "../../../rider-mobile/lib/sharedWSFactory.mjs";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  readyState = FakeWebSocket.CONNECTING;
  sent = [];
  onopen = null;
  onmessage = null;
  onerror = null;
  onclose = null;

  constructor(url) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(message) {
    this.sent.push(message);
  }

  close(code = 1000, reason = "") {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(data) {
    this.onmessage?.({ data });
  }

  failConnection() {
    this.close(1006, "network drop");
  }
}

function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("shared rider WebSocket", () => {
  it("authenticates a replacement socket after unsubscribe then resubscribe", async () => {
    FakeWebSocket.instances = [];
    const shared = createSharedWebSocket({
      WebSocketImpl: FakeWebSocket,
      getToken: async () => "valid-token",
      retryMs: 5,
    });
    const received = [];

    const unsubscribe = shared.subscribe((event) => received.push(event.data));
    const firstSocket = FakeWebSocket.instances[0];
    unsubscribe();
    const resubscribe = shared.subscribe((event) => received.push(event.data));
    const secondSocket = FakeWebSocket.instances[1];

    firstSocket.open();
    firstSocket.receive("stale");
    await nextTick();
    assert.deepEqual(firstSocket.sent, []);

    secondSocket.open();
    await nextTick();
    assert.deepEqual(secondSocket.sent, [
      JSON.stringify({ type: "auth", token: "valid-token" }),
    ]);
    secondSocket.receive("current");
    assert.deepEqual(received, ["current"]);

    resubscribe();
  });

  it("reconnects while subscribed after a network close", async () => {
    FakeWebSocket.instances = [];
    const shared = createSharedWebSocket({
      WebSocketImpl: FakeWebSocket,
      getToken: async () => "valid-token",
      retryMs: 5,
    });
    const unsubscribe = shared.subscribe(() => {});
    const firstSocket = FakeWebSocket.instances[0];
    firstSocket.open();
    firstSocket.failConnection();

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(FakeWebSocket.instances.length, 2);
    const replacement = FakeWebSocket.instances[1];
    replacement.open();
    await nextTick();
    assert.deepEqual(replacement.sent, [
      JSON.stringify({ type: "auth", token: "valid-token" }),
    ]);
    unsubscribe();
  });
});