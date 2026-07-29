/**
 * Integration test: GET /api/rider/earnings — pendingCollection accuracy
 *
 * Verifies that the earnings endpoint returns the rider's DB pendingCollection
 * value verbatim, with no additional arithmetic applied. This guards against
 * a double-deduction regression where computed order stats were incorrectly
 * subtracted from the DB value a second time.
 *
 * Scenarios covered:
 *   1. Rider with delivered prepaid non-COD orders + non-zero pendingCollection
 *      → response equals DB value exactly.
 *   2. The computed order stats do not bleed into pendingCollection.
 *   3. After an admin settlement (pendingCollection zeroed in DB)
 *      → response equals the new DB value (0), never lower.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { MongoClient, ObjectId } from "mongodb";
import type { AddressInfo } from "node:net";
import { connectMongo } from "../lib/mongo.js";
import app from "../app.js";

// ── env guard ─────────────────────────────────────────────────────────────────
const MONGODB_URI = process.env["MONGODB_URI_RIDER"];
if (!MONGODB_URI) throw new Error("MONGODB_URI_RIDER is required for tests");

// ── shared state set up in before() ──────────────────────────────────────────
let mongoClient: MongoClient;
let dbCol: { users: ReturnType<MongoClient["db"]>["collection"]; orders: ReturnType<MongoClient["db"]>["collection"] };
let serverUrl: string;
let server: ReturnType<typeof app.listen>;
let bearerToken: string;

const testRiderOid = new ObjectId();
const testOrderOids = [new ObjectId(), new ObjectId(), new ObjectId()];

// ── lifecycle ─────────────────────────────────────────────────────────────────
before(async () => {
  // 1. Connect the app's shared Mongo (same instance the route uses at runtime).
  await connectMongo();

  // 2. Direct client for seeding, assertions, and cleanup.
  mongoClient = new MongoClient(MONGODB_URI!);
  await mongoClient.connect();
  const db = mongoClient.db();
  dbCol = { users: db.collection.bind(db, "users"), orders: db.collection.bind(db, "orders") };

  // 3. Seed a test rider.
  //    pendingCollection = 750 PKR — a non-zero value the admin has not yet cleared.
  const { default: bcrypt } = await import("bcryptjs");
  const hashedPw = await bcrypt.hash("test-pw-9283", 12);

  await dbCol.users().insertOne({
    _id: testRiderOid,
    type: "rider",
    name: "Test Rider (earnings-test)",
    phone: "03001112233__earnings_test",
    password: hashedPw,
    city: "TestCity",
    vehicleType: "bike",
    isOnline: false,
    status: "idle",
    deleted: false,
    verified: false,
    orderCount: 0,
    riderZones: [],
    pendingCollection: 750,   // ← the known DB value assertions check against
    unpaidCollection: 0,
    tillNoonFare: 100,
    wallet: { amount: 0, isUsable: true },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // 4. Seed three delivered prepaid non-COD orders for this rider.
  //    "prepaid non-COD" = billingMode:"prepaid" + paymentType NOT in COD_TYPES.
  //    These are the exact orders that used to trigger a double-deduction bug.
  const now = new Date();
  const riderId = testRiderOid.toHexString();
  const orders = testOrderOids.map((oid, i) => ({
    _id: oid,
    riderId,
    status: "Delivered",
    billingMode: "prepaid",
    paymentType: "Online",           // non-COD — never cash-in-hand
    orderTotal: 500 + i * 100,       // 500 / 600 / 700
    products: [
      { name: `Item ${i}`, price: 450 + i * 100, actualPrice: 400 + i * 100, count: 1 },
    ],
    riderFare: 100,
    city: "TestCity",
    zone: "TestZone",
    createdAt: new Date(now.getTime() - i * 60_000),
    updatedAt: now,
    pickUpTime: now.toISOString(),
  }));
  await dbCol.orders().insertMany(orders);

  // 5. Start Express on an OS-assigned port.
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  serverUrl = `http://localhost:${port}`;

  // 6. Log in and obtain a bearer token (uses the live login endpoint).
  const loginRes = await fetch(`${serverUrl}/api/rider/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "03001112233__earnings_test", password: "test-pw-9283" }),
  });
  assert.equal(loginRes.status, 200, "Login should return 200");
  const loginBody = (await loginRes.json()) as Record<string, unknown>;
  assert.ok(
    typeof loginBody.token === "string" && loginBody.token.length > 0,
    "Login must return a token"
  );
  bearerToken = loginBody.token as string;
});

after(async () => {
  // Remove test data so the shared prod DB is left clean.
  await dbCol.users().deleteOne({ _id: testRiderOid });
  await dbCol.orders().deleteMany({ _id: { $in: testOrderOids } });
  await mongoClient.close();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

// ── helpers ───────────────────────────────────────────────────────────────────

async function fetchEarnings(): Promise<Record<string, unknown>> {
  const res = await fetch(`${serverUrl}/api/rider/earnings`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  assert.equal(res.status, 200, `Expected 200 from /api/rider/earnings, got ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

async function readDbPendingCollection(): Promise<number> {
  const doc = await dbCol.users().findOne({ _id: testRiderOid });
  return Number(doc?.pendingCollection) || 0;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/rider/earnings — pendingCollection accuracy", () => {
  it("returns pendingCollection equal to the DB value (no arithmetic applied)", async () => {
    const dbValue = await readDbPendingCollection();
    assert.equal(dbValue, 750, "Pre-condition: DB pendingCollection should be 750");

    const body = await fetchEarnings();

    assert.equal(
      body.pendingCollection,
      dbValue,
      `pendingCollection in response (${body.pendingCollection}) must equal the DB value (${dbValue}) exactly — no extra deduction allowed`
    );
  });

  it("computed order stats do not reduce pendingCollection", async () => {
    const body = await fetchEarnings();

    // Three seeded orders × tillNoonFare(100) = 300 PKR in earnings.
    assert.equal(
      body.totalDeliveries,
      3,
      "totalDeliveries should reflect the 3 seeded delivered orders"
    );
    assert.equal(
      body.totalEarnings,
      300,
      "totalEarnings should be 3 × tillNoonFare(100) = 300"
    );

    // pendingCollection must not have been reduced by the order-stats computation.
    assert.equal(
      body.pendingCollection,
      750,
      "pendingCollection must remain 750 even after order stats are aggregated"
    );
  });

  it("matches the settled DB value after an admin clears the balance — never lower", async () => {
    // Simulate an admin clearing the rider's balance.
    await dbCol.users().updateOne(
      { _id: testRiderOid },
      { $set: { pendingCollection: 0, updatedAt: new Date() } }
    );

    const dbValueAfterSettlement = await readDbPendingCollection();
    assert.equal(
      dbValueAfterSettlement,
      0,
      "Pre-condition: DB pendingCollection should be 0 after settlement"
    );

    const body = await fetchEarnings();

    // The API must reflect the DB value exactly — no additional deduction.
    assert.equal(
      body.pendingCollection,
      dbValueAfterSettlement,
      `After settlement, response pendingCollection (${body.pendingCollection}) must equal DB value (${dbValueAfterSettlement})`
    );

    // Explicit: response must never dip below what the DB holds.
    assert.ok(
      (body.pendingCollection as number) >= dbValueAfterSettlement,
      "Response pendingCollection must never be lower than the DB value"
    );
  });
});
