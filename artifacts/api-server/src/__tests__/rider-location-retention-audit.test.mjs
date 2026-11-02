import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIT_MAX_TIME_MS,
  auditRiderLocationRetention,
  main,
  retentionAuditPipeline,
} from "../../scripts/audit-rider-location-retention.mjs";

test("audit uses server receipt dates, a five-minute cutoff, and scalar type checks", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const pipeline = retentionAuditPipeline(now);
  const project = pipeline[0].$project;
  assert.deepEqual(project.timestampType, { $type: "$updatedAt" });
  assert.deepEqual(project.bucket.$cond[0], { $eq: [{ $type: "$updatedAt" }, "date"] });
  assert.deepEqual(
    project.bucket.$cond[1].$switch.branches,
    [
      { case: { $gt: ["$updatedAt", now] }, then: "future_date" },
      { case: { $lt: ["$updatedAt", new Date("2026-11-02T11:55:00Z")] }, then: "expired_date" },
    ],
  );
  assert.equal(project.bucket.$cond[1].$switch.default, "fresh_date");
  assert.equal(project.bucket.$cond[2], "legacy_or_invalid");
  assert.equal(project._id, 0);
  assert.deepEqual(pipeline.slice(1).map((stage) => Object.keys(stage)[0]), ["$group", "$sort"]);
  assert.throws(() => retentionAuditPipeline(new Date("invalid")));
});

test("audit only reads riderLocations and reports counts and safe index metadata", async () => {
  const calls = [];
  const counts = [{ _id: { timestampType: "date", bucket: "expired_date" }, count: 2 }];
  const db = {
    collection(name) {
      assert.equal(name, "riderLocations");
      return {
        aggregate(pipeline, options) {
          calls.push("aggregate");
          assert.equal(options.maxTimeMS, AUDIT_MAX_TIME_MS);
          assert.equal(options.allowDiskUse, false);
          assert.deepEqual(options.readConcern, { level: "majority" });
          return { async toArray() { return counts; } };
        },
        listIndexes(options) {
          calls.push("listIndexes");
          assert.equal(options.maxTimeMS, AUDIT_MAX_TIME_MS);
          return { async toArray() {
            return [{
              name: "existing",
              key: { updatedAt: 1 },
              expireAfterSeconds: 300,
              partialFilterExpression: { privateValue: "must not print" },
            }];
          } };
        },
      };
    },
  };
  const result = await auditRiderLocationRetention(db, new Date("2026-11-02T12:00:00Z"));
  assert.deepEqual(calls, ["aggregate", "listIndexes"]);
  assert.equal(result.readOnly, true);
  assert.equal(result.proposedRetentionSeconds, 300);
  assert.deepEqual(result.counts, counts);
  assert.equal(result.indexes[0].partial, true);
  assert.equal(JSON.stringify(result).includes("must not print"), false);
});

test("missing collection is reported without creating it; other errors fail", async () => {
  const db = (code) => ({
    collection() {
      return {
        aggregate() { return { async toArray() { return []; } }; },
        listIndexes() { return { async toArray() { throw { code }; } }; },
      };
    },
  });
  assert.deepEqual((await auditRiderLocationRetention(db(26))).indexes, []);
  await assert.rejects(auditRiderLocationRetention(db(13)));
});

test("CLI requires an explicit target before it can connect", async () => {
  await assert.rejects(main([]), /confirmed shared database/);
  await assert.rejects(main(["--apply"]), /confirmed shared database/);
  await assert.rejects(main(["--database", " "]), /confirmed shared database/);
});
