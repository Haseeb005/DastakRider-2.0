import assert from "node:assert/strict";
import test from "node:test";

import {
  claimRiderOrderPushes,
  finishRiderOrderPushClaims,
  type RiderOrderPushClaimStore,
} from "../lib/riderOrderPushDedupe";

type ClaimDocument = Record<string, any>;

class MemoryClaims implements RiderOrderPushClaimStore {
  documents = new Map<string, ClaimDocument>();

  async findOneAndUpdate(filter: any, update: any): Promise<unknown> {
    const current = this.documents.get(filter._id);
    if (
      !current ||
      current.state !== filter.state ||
      current.leaseExpiresAt > filter.leaseExpiresAt.$lte
    ) {
      return null;
    }
    Object.assign(current, update.$set);
    return { ...current };
  }

  async insertOne(document: ClaimDocument): Promise<unknown> {
    if (this.documents.has(document._id)) {
      throw Object.assign(new Error("duplicate key"), { code: 11000 });
    }
    this.documents.set(document._id, { ...document });
    return { acknowledged: true };
  }

  async updateMany(filter: any, update: any): Promise<unknown> {
    for (const condition of filter.$or) {
      const current = this.documents.get(condition._id);
      if (current?.token !== condition.token || current?.state !== "pending") {
        continue;
      }
      Object.assign(current, update.$set);
      for (const key of Object.keys(update.$unset ?? {})) delete current[key];
    }
    return { acknowledged: true };
  }

  async deleteMany(filter: any): Promise<unknown> {
    for (const condition of filter.$or) {
      const current = this.documents.get(condition._id);
      if (current?.token === condition.token && current?.state === "pending") {
        this.documents.delete(condition._id);
      }
    }
    return { acknowledged: true };
  }
}

const availableAt = new Date("2026-10-17T18:00:00.000Z");
const riders = [
  { _id: "rider-a", type: "rider", playerId: "subscription-a" },
  { _id: "rider-b", type: "rider" },
];

test("concurrent API workers claim at most one push per rider and offer", async () => {
  const store = new MemoryClaims();
  const [workerA, workerB] = await Promise.all([
    claimRiderOrderPushes(store, "order-1", availableAt, riders),
    claimRiderOrderPushes(store, "order-1", availableAt, riders),
  ]);

  assert.equal(workerA.length + workerB.length, riders.length);
  assert.equal(
    workerA.filter((claim) => claim.riderId === "rider-a").length +
      workerB.filter((claim) => claim.riderId === "rider-a").length,
    1,
  );
  assert.equal(
    workerA.filter((claim) => claim.riderId === "rider-b").length +
      workerB.filter((claim) => claim.riderId === "rider-b").length,
    1,
  );
});

test("the 30-second broad phase cannot notify priority riders twice", async () => {
  const store = new MemoryClaims();
  const priority = await claimRiderOrderPushes(
    store,
    "order-2",
    availableAt,
    [riders[0]],
  );
  await finishRiderOrderPushClaims(store, priority, true);

  const broadened = await claimRiderOrderPushes(
    store,
    "order-2",
    availableAt,
    riders,
  );
  assert.deepEqual(broadened.map((claim) => claim.riderId), ["rider-b"]);
});

test("a later availability generation may notify the same rider again", async () => {
  const store = new MemoryClaims();
  const first = await claimRiderOrderPushes(
    store,
    "order-3",
    availableAt,
    [riders[0]],
  );
  await finishRiderOrderPushClaims(store, first, true);

  const reopened = await claimRiderOrderPushes(
    store,
    "order-3",
    new Date(availableAt.getTime() + 1),
    [riders[0]],
  );
  assert.equal(reopened.length, 1);
});

test("a failed send releases its claim for retry", async () => {
  const store = new MemoryClaims();
  const first = await claimRiderOrderPushes(
    store,
    "order-4",
    availableAt,
    [riders[0]],
  );
  await finishRiderOrderPushClaims(store, first, false);

  const retry = await claimRiderOrderPushes(
    store,
    "order-4",
    availableAt,
    [riders[0]],
  );
  assert.equal(retry.length, 1);
});
