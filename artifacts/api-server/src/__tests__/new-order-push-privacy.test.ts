import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildNewOrderNotificationContent } from "../lib/onesignal.js";

describe("new-order push privacy boundary", () => {
  it("includes restaurant pickup context but no customer or order metadata", () => {
    const content = buildNewOrderNotificationContent({
      restaurantName: "Push Test Restaurant",
      martAddress: "12 Restaurant Pickup Road",
    });

    assert.deepEqual(content, {
      heading: "New Order Available",
      message: "Push Test Restaurant · 12 Restaurant Pickup Road",
      data: {
        screen: "newOrder",
      },
    });

    const serialized = JSON.stringify(content);
    for (const privateValue of [
      "customerName",
      "Private Customer",
      "Private Customer Item",
      "COD",
      "1800",
      "275",
      "Private delivery note",
      "PRIVATE-ORDER-61",
      "customerAddress",
      "orderNum",
      "orderId",
    ]) {
      assert.equal(
        serialized.includes(privateValue),
        false,
        `new-order push leaked ${privateValue}`,
      );
    }
  });
});