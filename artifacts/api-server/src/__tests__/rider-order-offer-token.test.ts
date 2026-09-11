import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  signOrderAcceptConfirmationToken,
  signOrderOfferToken,
  verifyOrderAcceptConfirmationToken,
  verifyOrderOfferToken,
} from "../lib/riderToken.js";

describe("rider order action tokens", () => {
  const payload = {
    orderId: "66f19d61f67b3b2a18a7e14d",
    riderId: "66f19d61f67b3b2a18a7e14e",
    expiresAt: Date.now() + 60_000,
    nonce: "A5OG_QHmOHn0zSUxPHDce1oM",
  };

  it("verifies a current offer bound to one rider and one order", () => {
    const token = signOrderOfferToken(payload);

    assert.deepEqual(verifyOrderOfferToken(token), payload);
  });

  it("rejects a tampered or expired offer", () => {
    const token = signOrderOfferToken(payload);
    assert.equal(verifyOrderOfferToken(`${token}x`), null);

    const expired = signOrderOfferToken({
      ...payload,
      expiresAt: Date.now() - 1,
    });
    assert.equal(verifyOrderOfferToken(expired), null);
  });

  it("keeps suspicious-activity confirmations separate from ordinary offers", () => {
    const offer = signOrderOfferToken(payload);
    const confirmation = signOrderAcceptConfirmationToken(payload);

    assert.deepEqual(verifyOrderAcceptConfirmationToken(confirmation), payload);
    assert.equal(verifyOrderAcceptConfirmationToken(offer), null);
    assert.equal(verifyOrderOfferToken(confirmation), null);
  });
});