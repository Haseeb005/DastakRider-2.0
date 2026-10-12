import assert from "node:assert/strict";
import test from "node:test";

import {
  getRiderOfferAudience,
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
    new Map([["busy", 1]]),
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
    new Map([["busy", 1]]),
    Date.parse("2026-10-12T12:00:30.000Z"),
  );

  assert.equal(audience.idlePriorityActive, false);
  assert.equal(riderCanSeeAvailableOrder("busy", audience), true);
});

test("when nobody is idle, do not delay new orders for riders under their cap", () => {
  const audience = getRiderOfferAudience(
    order,
    riders,
    new Map([["idle-a", 1], ["idle-b", 1], ["busy", 1]]),
    Date.parse("2026-10-12T12:00:01.000Z"),
  );

  assert.equal(audience.idlePriorityActive, false);
  assert.equal(audience.eligibleRiders.length, 3);
});

test("online, city, zone, and max-order eligibility are applied before prioritizing", () => {
  const candidates = [
    ...riders,
    { _id: "offline", type: "rider", isOnline: false, city: "Lahore" },
    { _id: "other-city", type: "rider", isOnline: true, city: "Karachi" },
    { _id: "other-zone", type: "rider", isOnline: true, city: "Lahore", riderZones: ["DHA"] },
    { _id: "at-cap", type: "rider", isOnline: true, city: "Lahore", maxOrderLimit: 1 },
  ];
  const audience = getRiderOfferAudience(
    order,
    candidates,
    new Map([["busy", 1], ["at-cap", 1]]),
    Date.parse("2026-10-12T12:00:01.000Z"),
  );

  assert.deepEqual(
    audience.eligibleRiders.map((rider) => String(rider._id)).sort(),
    ["busy", "idle-a", "idle-b"],
  );
});
