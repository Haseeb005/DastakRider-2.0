import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getAvailableOrderCardData } from "../lib/availableOrderCard.ts";

describe("web available-order card", () => {
  it("renders only restaurant pickup data before acceptance", () => {
    const cardData = getAvailableOrderCardData({
      id: "order-private-1",
      restaurantName: "Dastak Kitchen",
      martAddress: "12 Pickup Street",
      martPhone: "03001234567",
      martLatitude: 24.86,
      martLongitude: 67.01,
      userName: "Private Customer",
      items: [{ name: "Private Basket Item", quantity: 2, price: 900 }],
      paymentType: "COD",
      total: 1800,
      riderFare: 250,
      comment: "Private delivery note",
      orderNum: "ORDER-PRIVATE-1",
    } as never);

    assert.deepEqual(cardData, {
      restaurantName: "Dastak Kitchen",
      martAddress: "12 Pickup Street",
      martPhone: "03001234567",
      mapTarget: "24.86,67.01",
    });
    assert.equal(JSON.stringify(cardData).includes("Private"), false);
    assert.equal(JSON.stringify(cardData).includes("1800"), false);
    assert.equal(JSON.stringify(cardData).includes("COD"), false);
  });
});