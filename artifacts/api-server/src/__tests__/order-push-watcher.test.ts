import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectId } from "mongodb";

type OrderChangeListener = (change: {
  collection: "orders" | "chats";
  id: string;
}) => void | Promise<void>;

describe("order push watcher database-to-transport boundary", () => {
  it("targets eligible riders, sends pickup-only content, and retries failed sends", async (t) => {
    const rawId = "507f1f77bcf86cd799439011";
    const orderId = new ObjectId(rawId);
    const order = {
      _id: orderId,
      status: "Admin Accepted",
      riderId: "",
      city: "Karachi",
      zone: "Clifton",
      martName: "Pickup Restaurant",
      martAddress: "12 Pickup Road",
      name: "Private Customer",
      address: "Private Destination",
      products: [{ productName: "Private Item", price: 900 }],
      paymentType: "COD",
      riderFare: 275,
      orderNum: "PRIVATE-ORDER",
    };
    const riders = [
      { _id: new ObjectId("507f1f77bcf86cd799439012"), playerId: "subscription-1" },
      { _id: new ObjectId("507f1f77bcf86cd799439013") },
    ];

    let orderQuery: Record<string, unknown> | undefined;
    let riderQuery: Record<string, unknown> | undefined;
    let changeListener: OrderChangeListener | undefined;
    const sentPayloads: Record<string, unknown>[] = [];
    let sendAttempts = 0;

    t.mock.module("../lib/mongo.js", {
      namedExports: {
        ordersCol: () => ({
          findOne: async (query: Record<string, unknown>) => {
            orderQuery = query;
            return order;
          },
        }),
        usersCol: () => ({
          find: (query: Record<string, unknown>) => {
            riderQuery = query;
            return {
              limit: () => ({
                toArray: async () => riders,
              }),
            };
          },
        }),
        subscribeToLiveChanges: (listener: OrderChangeListener) => {
          changeListener = listener;
          return () => {};
        },
      },
    });
    t.mock.module("../lib/onesignal.js", {
      namedExports: {
        sendNewOrderPush: async (payload: Record<string, unknown>) => {
          sentPayloads.push(payload);
          sendAttempts += 1;
          return sendAttempts > 1;
        },
      },
    });

    const { startOrderPushWatcher } = await import("../lib/orderPushWatcher.js");
    startOrderPushWatcher();
    assert.ok(changeListener);

    await changeListener({ collection: "orders", id: rawId });
    await changeListener({ collection: "orders", id: rawId });

    assert.deepEqual(orderQuery, { _id: orderId });
    assert.deepEqual(riderQuery, {
      type: "rider",
      isOnline: true,
      deleted: { $ne: true },
      city: "Karachi",
      $or: [
        { riderZones: "Clifton" },
        { riderZones: { $exists: false } },
        { riderZones: { $size: 0 } },
      ],
    });
    assert.deepEqual(sentPayloads, [
      {
        playerIds: ["subscription-1"],
        riderIds: ["507f1f77bcf86cd799439013"],
        restaurantName: "Pickup Restaurant",
        martAddress: "12 Pickup Road",
      },
      {
        playerIds: ["subscription-1"],
        riderIds: ["507f1f77bcf86cd799439013"],
        restaurantName: "Pickup Restaurant",
        martAddress: "12 Pickup Road",
      },
    ]);
    assert.equal(sendAttempts, 2);

    const serializedPayload = JSON.stringify(sentPayloads);
    for (const privateValue of [
      "Private Customer",
      "Private Destination",
      "Private Item",
      "COD",
      "275",
      "PRIVATE-ORDER",
    ]) {
      assert.equal(
        serializedPayload.includes(privateValue),
        false,
        `watcher leaked ${privateValue} to the notification sender`,
      );
    }
  });
});