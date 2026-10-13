import assert from "node:assert/strict";
import test from "node:test";

import {
  canAcceptAnotherLiveOrder,
  getRiderOfferAudience,
  isOrderLimitExemptRider,
  riderCanSeeAvailableOrder,
} from "../lib/riderOrderDistribution";

const order = {
  city: "Lahore",
  zone: "Gulberg",
  riderOfferStartedAt: new Date("2026-10-12T12:00:00.000Z"),
};
const riders = [
  { _id: "idle-a", type: "rider", isOnline: true, city: "Lahore", riderZones: ["Gulberg"] },
  { _id: "idle-b", type: "rider", isOnline: true, city: "Lahore", riderZones: ["Gulberg"] },
  { _id: "busy", type: "rider", isOnline: true, city: "Lahore", riderZones: ["Gulberg"] },
];

test("during the first 30 seconds only eligible idle riders can see an order", () => {
  const audience = getRiderOfferAudience(
    order,
    riders,
    new Map([["busy", { activeCount: 1, acceptedCount: 0, pickedUpCount: 1 }]]),
    Date.parse("2026-10-12T12:00:29.999Z"),
  );

  assert.equal(audience.idlePriorityActive, true);
  assert.equal(riderCanSeeAvailableOrder("idle-a", audience), true);
  assert.equal(riderCanSeeAvailableOrder("busy", audience), false);
});

test("the order opens to all eligible riders at the 30-second boundary", () => {
  const audience = getRiderOfferAudience(
    order,
    riders,
    new Map([["busy", { activeCount: 1, acceptedCount: 0, pickedUpCount: 1 }]]),
    Date.parse("2026-10-12T12:00:30.000Z"),
  );

  assert.equal(audience.idlePriorityActive, false);
  assert.equal(riderCanSeeAvailableOrder("busy", audience), true);
});

test("when nobody is idle, picked-up riders wait until the 30-second window ends", () => {
  const audience = getRiderOfferAudience(
    order,
    riders,
    new Map([
      ["idle-a", { activeCount: 1, acceptedCount: 1, pickedUpCount: 0 }],
      ["idle-b", { activeCount: 1, acceptedCount: 1, pickedUpCount: 0 }],
      ["busy", { activeCount: 1, acceptedCount: 0, pickedUpCount: 1 }],
    ]),
    Date.parse("2026-10-12T12:00:01.000Z"),
  );

  assert.equal(audience.priorityWindowOpen, true);
  assert.equal(audience.eligibleRiders.length, 1);
  assert.equal(riderCanSeeAvailableOrder("busy", audience), false);
});

test("rider accepted orders block another acceptance even after 30 seconds", () => {
  const audience = getRiderOfferAudience(
    order,
    riders,
    new Map([["busy", { activeCount: 1, acceptedCount: 1, pickedUpCount: 0 }]]),
    Date.parse("2026-10-12T12:00:30.000Z"),
  );

  assert.equal(riderCanSeeAvailableOrder("busy", audience), false);
});

test("picked-up riders can take a second live order, but not a third", () => {
  const ridersWithStatus = [
    { _id: "one-picked-up", type: "rider", isOnline: true, city: "Lahore", maxOrderLimit: 1 },
    { _id: "two-picked-up", type: "rider", isOnline: true, city: "Lahore" },
  ];
  const audience = getRiderOfferAudience(
    order,
    ridersWithStatus,
    new Map([
      ["one-picked-up", { activeCount: 1, acceptedCount: 0, pickedUpCount: 1 }],
      ["two-picked-up", { activeCount: 2, acceptedCount: 0, pickedUpCount: 2 }],
    ]),
    Date.parse("2026-10-12T12:00:30.000Z"),
  );

  assert.equal(riderCanSeeAvailableOrder("one-picked-up", audience), true);
  assert.equal(riderCanSeeAvailableOrder("two-picked-up", audience), false);
});

test("only the two approved rider accounts bypass live-order and pickup-before-accept limits", () => {
  const khanBabaId = "63d903994c2d23004da46c15";
  const tornadoId = "63d9097c4c2d23004da46c18";
  const overLimit = { activeCount: 8, acceptedCount: 5, pickedUpCount: 3 };

  assert.equal(isOrderLimitExemptRider(khanBabaId), true);
  assert.equal(isOrderLimitExemptRider(tornadoId), true);
  assert.equal(canAcceptAnotherLiveOrder(khanBabaId, overLimit), true);
  assert.equal(canAcceptAnotherLiveOrder(tornadoId, overLimit), true);
  assert.equal(canAcceptAnotherLiveOrder("regular-rider", overLimit), false);
});

test("busy exempt riders can see offers after the regular 30-second idle priority", () => {
  const exemptId = "63d903994c2d23004da46c15";
  const exemptRider = {
    _id: exemptId,
    type: "rider",
    isOnline: true,
    city: "Lahore",
    riderZones: ["Gulberg"],
  };
  const counts = new Map([
    [exemptId, { activeCount: 4, acceptedCount: 3, pickedUpCount: 1 }],
  ]);
  const beforePriorityEnds = getRiderOfferAudience(
    order,
    [exemptRider, ...riders.filter((rider) => rider._id !== "idle-a" && rider._id !== "idle-b")],
    counts,
    Date.parse("2026-10-12T12:00:29.999Z"),
  );
  const afterPriorityEnds = getRiderOfferAudience(
    order,
    [exemptRider],
    counts,
    Date.parse("2026-10-12T12:00:30.000Z"),
  );

  assert.equal(riderCanSeeAvailableOrder(exemptId, beforePriorityEnds), false);
  assert.equal(riderCanSeeAvailableOrder(exemptId, afterPriorityEnds), true);
});

test("online, city, and zone eligibility are applied before prioritizing", () => {
  const candidates = [
    ...riders,
    { _id: "offline", type: "rider", isOnline: false, city: "Lahore" },
    { _id: "other-city", type: "rider", isOnline: true, city: "Karachi" },
    { _id: "other-zone", type: "rider", isOnline: true, city: "Lahore", riderZones: ["DHA"] },
  ];
  const audience = getRiderOfferAudience(
    order,
    candidates,
    new Map([["busy", { activeCount: 1, acceptedCount: 0, pickedUpCount: 1 }]]),
    Date.parse("2026-10-12T12:00:01.000Z"),
  );

  assert.deepEqual(
    audience.eligibleRiders.map((rider) => String(rider._id)).sort(),
    ["busy", "idle-a", "idle-b"],
  );
  assert.equal(riderCanSeeAvailableOrder("busy", audience), false);
});
