import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AvailableRiderOrder } from "../src/generated/api.schemas";
import { findRenewedOffer } from "../src/offerRetry";

const now = Date.now();
const offer = (id: string, token: string, expiresAt = now + 60_000): AvailableRiderOrder => ({
  id,
  payCashToRestaurant: false,
  offerToken: token,
  offerExpiresAt: new Date(expiresAt).toISOString(),
});

describe("renewing a rejected rider offer", () => {
  it("retries only the same order with a different unexpired signed offer", () => {
    const rejected = offer("order-a", "old-token", now - 1);
    const renewed = offer("order-a", "new-token");
    assert.equal(findRenewedOffer(rejected, [offer("order-b", "other-token"), renewed], now), renewed);
    assert.equal(findRenewedOffer(rejected, [rejected], now), null);
    assert.equal(findRenewedOffer(rejected, [offer("order-a", "new-token", now - 1)], now), null);
  });

  it("does not retry an order that has disappeared or a failed refresh", () => {
    const rejected = offer("order-a", "old-token", now - 1);
    assert.equal(findRenewedOffer(rejected, [offer("order-b", "other-token")], now), null);
    assert.equal(findRenewedOffer(rejected, [], now), null);
    assert.equal(findRenewedOffer(rejected, undefined, now), null);
  });
});