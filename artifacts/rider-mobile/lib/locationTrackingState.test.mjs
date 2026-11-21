import assert from "node:assert/strict";
import test from "node:test";
import {
  capturedAtForFreshFix,
  MAX_GPS_FIX_AGE_MS,
  selectActiveDeliveryOrderIds,
} from "../../../lib/api-client-react/src/locationPayload.mjs";

const orderA = "abcdef0123456789abcdef01";
const orderB = "abcdef0123456789abcdef02";

test("only active picked-up deliveries use canonical _id or id fallback", () => {
  assert.deepEqual(
    selectActiveDeliveryOrderIds([
      { _id: orderA.toUpperCase(), id: orderB, status: "Rider Picked Up" },
      { id: orderB, status: "Rider Picked Up" },
      { id: "restaurant-order-number", status: "Rider Picked Up" },
      { id: orderA, status: "Rider Accepted" },
      { id: orderA, status: "Delivered" },
    ]),
    [orderA, orderB],
  );
});

test("GPS capture timestamp is ISO and rejects stale or future fixes", () => {
  const now = Date.parse("2026-11-21T11:50:00.000Z");
  assert.equal(
    capturedAtForFreshFix(now - 5_000, now),
    "2026-11-21T11:49:55.000Z",
  );
  assert.equal(capturedAtForFreshFix(now - MAX_GPS_FIX_AGE_MS - 1, now), null);
  assert.equal(capturedAtForFreshFix(now + 1, now), null);
  assert.equal(capturedAtForFreshFix(Number.NaN, now), null);
});
