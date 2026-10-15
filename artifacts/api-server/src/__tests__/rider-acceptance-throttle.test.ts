import assert from "node:assert/strict";
import test from "node:test";

import {
  getRiderAcceptanceCooldownRemainingMs,
  RIDER_ACCEPTANCE_COOLDOWN_MS,
} from "../lib/riderAcceptanceThrottle";

test("first acceptance has no cooldown", () => {
  assert.equal(getRiderAcceptanceCooldownRemainingMs(undefined, 1_000), 0);
});

test("rapid subsequent acceptance is throttled for the remaining window", () => {
  assert.equal(
    getRiderAcceptanceCooldownRemainingMs(new Date(10_000), 10_750),
    RIDER_ACCEPTANCE_COOLDOWN_MS - 750,
  );
});

test("acceptance is allowed once the cooldown expires", () => {
  assert.equal(
    getRiderAcceptanceCooldownRemainingMs(10_000, 11_000),
    0,
  );
});

test("acceptance remains throttled until the full one-second cooldown expires", () => {
  assert.equal(
    getRiderAcceptanceCooldownRemainingMs(10_000, 10_999),
    1,
  );
});

test("invalid stored timestamps do not create a permanent lockout", () => {
  assert.equal(getRiderAcceptanceCooldownRemainingMs("invalid-date", 10_000), 0);
});
