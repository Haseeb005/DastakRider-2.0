import assert from "node:assert/strict";
import test from "node:test";

import { fastDeliveryDurationMinutes } from "../lib/fastDeliveryEligibility";

test("qualifies accepted-to-delivered durations up to and including 20 minutes", () => {
  const acceptedAt = new Date("2026-10-20T10:00:00.000Z");

  assert.equal(
    fastDeliveryDurationMinutes(
      acceptedAt,
      new Date(acceptedAt.getTime() + 20 * 60_000),
    ),
    20,
  );
  assert.equal(
    fastDeliveryDurationMinutes(
      acceptedAt,
      new Date(acceptedAt.getTime() + 18 * 60_000 + 22_000),
    ),
    18 + 22 / 60,
  );
});

test("rejects deliveries over 20 minutes, negative durations, and invalid times", () => {
  const acceptedAt = new Date("2026-10-20T10:00:00.000Z");

  assert.equal(
    fastDeliveryDurationMinutes(
      acceptedAt,
      new Date(acceptedAt.getTime() + 20 * 60_000 + 1),
    ),
    null,
  );
  assert.equal(
    fastDeliveryDurationMinutes(
      acceptedAt,
      new Date(acceptedAt.getTime() - 1),
    ),
    null,
  );
  assert.equal(
    fastDeliveryDurationMinutes("not a date", new Date()),
    null,
  );
});
