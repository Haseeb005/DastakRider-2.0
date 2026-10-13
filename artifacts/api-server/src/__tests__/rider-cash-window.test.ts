import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { currentWindowCodDeliveryFilter } from "../lib/riderCashWindow";

describe("current-window COD delivery lookup", () => {
  const cutoff = new Date("2026-10-13T03:00:00.000Z");
  const filter = currentWindowCodDeliveryFilter("rider-test", cutoff);

  it("scopes deliveries to the assigned rider without relying on shared status", () => {
    assert.equal(filter.riderId, "rider-test");
    assert.ok(!JSON.stringify(filter).includes('"status"'));
  });

  it("recognizes modern deliveries by their actual delivery timestamp", () => {
    assert.deepEqual(filter.$and[1].$or?.[0], {
      riderDeliveredAt: { $gte: cutoff },
    });
  });

  it("recognizes legacy deliveries only when created in this window and delivered", () => {
    assert.deepEqual(filter.$and[1].$or?.[1], {
      riderDeliveredAt: null,
      createdAt: { $gte: cutoff },
      timeWhenDelivered: { $type: "string", $ne: "" },
    });
  });

  it("uses the fallback payment field only when the primary field is empty", () => {
    assert.deepEqual(filter.$and[0].$or, [
      { paymentType: { $in: ["COD", "Cash", "cash", "cod"] } },
      {
        paymentType: { $in: [null, ""] },
        paymentMethod: { $in: ["COD", "Cash", "cash", "cod"] },
      },
    ]);
  });
});
