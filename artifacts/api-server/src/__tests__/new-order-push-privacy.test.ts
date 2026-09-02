import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildNewOrderNotificationContent,
  sendNewOrderPush,
  type OneSignalTransport,
} from "../lib/onesignal.js";

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

  it("passes the privacy-safe content unchanged to OneSignal", async () => {
    let sentNotification: any;
    const transport: OneSignalTransport = {
      appId: "test-rider-app",
      client: {
        createNotification: async (notification) => {
          sentNotification = notification;
          return { id: "test-notification-id" };
        },
      },
    };

    const sent = await sendNewOrderPush(
      {
        playerIds: ["subscription-1"],
        restaurantName: "Push Test Restaurant",
        martAddress: "12 Restaurant Pickup Road",
      },
      transport,
    );

    assert.equal(sent, true);
    assert.deepEqual(sentNotification.headings, {
      en: "New Order Available",
    });
    assert.deepEqual(sentNotification.contents, {
      en: "Push Test Restaurant · 12 Restaurant Pickup Road",
    });
    assert.deepEqual(sentNotification.data, {
      screen: "newOrder",
    });
  });

  it("keeps subscription and external rider targeting in the SDK payload", async () => {
    let sentNotification: any;
    const transport: OneSignalTransport = {
      appId: "test-rider-app",
      client: {
        createNotification: async (notification) => {
          sentNotification = notification;
          return { id: "test-notification-id" };
        },
      },
    };

    const sent = await sendNewOrderPush(
      {
        playerIds: ["subscription-1", "subscription-2"],
        riderIds: ["rider-without-subscription"],
        restaurantName: "Targeting Test Restaurant",
      },
      transport,
    );

    assert.equal(sent, true);
    assert.deepEqual(sentNotification.include_subscription_ids, [
      "subscription-1",
      "subscription-2",
    ]);
    assert.deepEqual(sentNotification.include_aliases, {
      external_id: ["rider-without-subscription"],
    });
  });
});