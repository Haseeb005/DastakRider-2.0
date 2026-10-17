import assert from "node:assert/strict";
import test from "node:test";

import {
  createRiderPlayerIdVerificationHandler,
  type RiderPlayerIdVerificationResponse,
} from "../lib/riderPlayerIdVerification.js";

interface ResponseCapture extends RiderPlayerIdVerificationResponse {
  statusCode: number;
  body: Record<string, unknown> | null;
}

function responseCapture(): ResponseCapture {
  const response: ResponseCapture = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return body;
    },
  };
  return response;
}

function makeHandler(
  savedPlayers: Record<string, string | undefined>,
  lookedUpRiderIds: string[],
) {
  return createRiderPlayerIdVerificationHandler({
    getAuthenticatedRiderId: (req, res) => {
      const riderId = (req as { authenticatedRiderId?: string })
        .authenticatedRiderId;
      if (!riderId) {
        res.status(401).json({ message: "Rider not logged in" });
        return null;
      }
      return riderId;
    },
    findRiderById: async (riderId) => {
      lookedUpRiderIds.push(riderId);
      return riderId in savedPlayers
        ? { playerId: savedPlayers[riderId] }
        : null;
    },
  });
}

test("requires an authenticated rider", async () => {
  const lookedUpRiderIds: string[] = [];
  const handler = makeHandler({ "rider-a": "private-subscription-a" }, lookedUpRiderIds);
  const response = responseCapture();

  await handler({ body: { playerId: "private-subscription-a" } }, response);

  assert.equal(response.statusCode, 401);
  assert.deepEqual(lookedUpRiderIds, []);
});

test("checks only the authenticated rider even if the request names another rider", async () => {
  const lookedUpRiderIds: string[] = [];
  const handler = makeHandler(
    {
      "rider-a": "subscription-a",
      "rider-b": "subscription-b",
    },
    lookedUpRiderIds,
  );
  const response = responseCapture();

  await handler(
    {
      authenticatedRiderId: "rider-a",
      body: { riderId: "rider-b", playerId: "subscription-a" },
    } as never,
    response,
  );

  assert.deepEqual(lookedUpRiderIds, ["rider-a"]);
  assert.deepEqual(response.body, {
    savedSubscriptionPresent: true,
    matchesCurrentSubscription: true,
  });
  assert.equal(JSON.stringify(response.body).includes("subscription-a"), false);
  assert.equal(JSON.stringify(response.body).includes("subscription-b"), false);
});

test("reports a missing current subscription without returning any subscription ID", async () => {
  const lookedUpRiderIds: string[] = [];
  const handler = makeHandler({ "rider-a": "saved-subscription" }, lookedUpRiderIds);
  const response = responseCapture();

  await handler(
    {
      authenticatedRiderId: "rider-a",
      body: { playerId: null },
    } as never,
    response,
  );

  assert.deepEqual(response.body, {
    savedSubscriptionPresent: true,
    matchesCurrentSubscription: false,
  });
  assert.equal(JSON.stringify(response.body).includes("saved-subscription"), false);
});

test("reports a mismatched current subscription without returning either ID", async () => {
  const lookedUpRiderIds: string[] = [];
  const handler = makeHandler({ "rider-a": "saved-subscription" }, lookedUpRiderIds);
  const response = responseCapture();

  await handler(
    {
      authenticatedRiderId: "rider-a",
      body: { playerId: "different-subscription" },
    } as never,
    response,
  );

  assert.deepEqual(response.body, {
    savedSubscriptionPresent: true,
    matchesCurrentSubscription: false,
  });
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes("saved-subscription"), false);
  assert.equal(serialized.includes("different-subscription"), false);
});

test("reports no saved subscription when the rider has none", async () => {
  const lookedUpRiderIds: string[] = [];
  const handler = makeHandler({ "rider-a": "" }, lookedUpRiderIds);
  const response = responseCapture();

  await handler(
    {
      authenticatedRiderId: "rider-a",
      body: { playerId: null },
    } as never,
    response,
  );

  assert.deepEqual(response.body, {
    savedSubscriptionPresent: false,
    matchesCurrentSubscription: false,
  });
});

test("returns a safe server error if the rider lookup fails", async () => {
  const handler = createRiderPlayerIdVerificationHandler({
    getAuthenticatedRiderId: () => "rider-a",
    findRiderById: async () => {
      throw new Error("database unavailable");
    },
  });
  const response = responseCapture();

  await handler({ body: { playerId: "private-subscription" } }, response);

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    message: "Could not check notification registration",
  });
  assert.equal(JSON.stringify(response.body).includes("private-subscription"), false);
});
