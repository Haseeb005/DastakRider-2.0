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
import type { Collection, Document } from "mongodb";
import type { AddressInfo } from "node:net";
import { connectMongo } from "../lib/mongo.js";
import app from "../app.js";

// ── env guard ─────────────────────────────────────────────────────────────────
const MONGODB_URI = process.env["MONGODB_URI_RIDER"];
if (!MONGODB_URI) throw new Error("MONGODB_URI_RIDER is required for tests");

// ── shared state set up in before() ──────────────────────────────────────────
let mongoClient: MongoClient;
let dbCol: {
  users: () => Collection<Document>;
  orders: () => Collection<Document>;
  riderChallenges: () => Collection<Document>;
  riderWalletEntries: () => Collection<Document>;
};
let serverUrl: string;
let server: ReturnType<typeof app.listen>;
let bearerToken: string;

const testRiderOid = new ObjectId();
const testOrderOids = [new ObjectId(), new ObjectId(), new ObjectId()];
const boundaryOrderOids = [new ObjectId(), new ObjectId()];
const walletOrderOids = Array.from({ length: 7 }, () => new ObjectId());

// ── lifecycle ─────────────────────────────────────────────────────────────────
before(async () => {
  // 1. Connect the app's shared Mongo (same instance the route uses at runtime).
  await connectMongo();

  // 2. Direct client for seeding, assertions, and cleanup.
  mongoClient = new MongoClient(MONGODB_URI!);
  await mongoClient.connect();
  const db = mongoClient.db();
  dbCol = {
    users: db.collection.bind(db, "users"),
    orders: db.collection.bind(db, "orders"),
    riderChallenges: db.collection.bind(db, "riderChallenges"),
    riderWalletEntries: db.collection.bind(db, "riderWalletEntries"),
  };

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
  // These fixtures straddle PKT midnight:
  //   2099-08-23T18:59:59.999Z = 2099-08-23 23:59:59.999 PKT
  //   2099-08-23T19:00:00.001Z = 2099-08-24 00:00:00.001 PKT
  // The distant date keeps the moving "now" fixtures above out of these
  // date-specific assertions.
  const boundaryOrders = [
    {
      _id: boundaryOrderOids[0],
      riderId,
      status: "Delivered",
      billingMode: "postpaid",
      paymentType: "COD",
      orderTotal: 500,
      products: [],
      riderFare: 100,
      city: "TestCity",
      zone: "TestZone",
      createdAt: new Date("2099-08-23T18:59:59.999Z"),
      updatedAt: new Date("2099-08-23T18:59:59.999Z"),
      pickUpTime: "23:00:00",
      timeWhenDelivered: "23:59:59",
    },
    {
      _id: boundaryOrderOids[1],
      riderId,
      status: "Delivered",
      billingMode: "postpaid",
      paymentType: "COD",
      orderTotal: 700,
      products: [],
      riderFare: 100,
      city: "TestCity",
      zone: "TestZone",
      createdAt: new Date("2099-08-23T19:00:00.001Z"),
      updatedAt: new Date("2099-08-23T19:00:00.001Z"),
      pickUpTime: "00:00:00",
      timeWhenDelivered: "00:00:01",
    },
  ];
  await dbCol.orders().insertMany([...orders, ...boundaryOrders]);

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
  await dbCol.orders().deleteMany({
    _id: { $in: [...testOrderOids, ...boundaryOrderOids, ...walletOrderOids] },
  });
  await dbCol.riderChallenges().deleteMany({ riderId: testRiderOid.toHexString() });
  await dbCol.riderWalletEntries().deleteMany({ riderId: testRiderOid.toHexString() });
  await mongoClient.close();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

// ── helpers ───────────────────────────────────────────────────────────────────

async function fetchEarnings(date?: string): Promise<Record<string, unknown>> {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  const res = await fetch(`${serverUrl}/api/rider/earnings${query}`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  assert.equal(res.status, 200, `Expected 200 from /api/rider/earnings, got ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

async function fetchHistory(date: string): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(
    `${serverUrl}/api/rider/orders/history?date=${encodeURIComponent(date)}`,
    {
      headers: { Authorization: `Bearer ${bearerToken}` },
    }
  );
  assert.equal(
    res.status,
    200,
    `Expected 200 from /api/rider/orders/history, got ${res.status}`
  );
  return res.json() as Promise<Array<Record<string, unknown>>>;
}

async function fetchWallet(): Promise<Record<string, unknown>> {
  const res = await fetch(`${serverUrl}/api/rider/wallet`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  assert.equal(res.status, 200, `Expected 200 from /api/rider/wallet, got ${res.status}`);
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

    // Five seeded orders × tillNoonFare(100) = 500 PKR in earnings.
    assert.equal(
      body.totalDeliveries,
      5,
      "totalDeliveries should reflect the 5 seeded delivered orders"
    );
    assert.equal(
      body.totalEarnings,
      500,
      "totalEarnings should be 5 × tillNoonFare(100) = 500"
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

describe("PKT calendar date filtering", () => {
  it("keeps either side of PKT midnight in its own history date", async () => {
    const precedingDay = await fetchHistory("2099-08-23");
    const followingDay = await fetchHistory("2099-08-24");

    assert.deepEqual(
      precedingDay.map((order) => order.id),
      [boundaryOrderOids[0].toHexString()],
      "the order immediately before PKT midnight belongs only to the preceding date"
    );
    assert.deepEqual(
      followingDay.map((order) => order.id),
      [boundaryOrderOids[1].toHexString()],
      "the order immediately after PKT midnight belongs only to the following date"
    );
  });

  it("reports only the requested PKT date in earnings totals", async () => {
    const precedingDay = await fetchEarnings("2099-08-23");
    const followingDay = await fetchEarnings("2099-08-24");

    assert.deepEqual(
      {
        selectedDate: precedingDay.selectedDate,
        deliveries: precedingDay.selectedDeliveries,
        orderAmount: precedingDay.selectedOrderAmount,
        earnings: precedingDay.selectedEarnings,
      },
      {
        selectedDate: "2099-08-23",
        deliveries: 1,
        orderAmount: 500,
        earnings: 100,
      }
    );
    assert.deepEqual(
      {
        selectedDate: followingDay.selectedDate,
        deliveries: followingDay.selectedDeliveries,
        orderAmount: followingDay.selectedOrderAmount,
        earnings: followingDay.selectedEarnings,
      },
      {
        selectedDate: "2099-08-24",
        deliveries: 1,
        orderAmount: 700,
        earnings: 100,
      }
    );
  });

  it("rejects invalid calendar dates on history and earnings", async () => {
    const headers = { Authorization: `Bearer ${bearerToken}` };
    const invalidDate = "2099-02-29";

    const historyRes = await fetch(
      `${serverUrl}/api/rider/orders/history?date=${invalidDate}`,
      { headers }
    );
    assert.equal(historyRes.status, 400);
    assert.deepEqual(await historyRes.json(), {
      message: "date must be a valid YYYY-MM-DD value",
    });

    const earningsRes = await fetch(
      `${serverUrl}/api/rider/earnings?date=${invalidDate}`,
      { headers }
    );
    assert.equal(earningsRes.status, 400);
    assert.deepEqual(await earningsRes.json(), {
      message: "date must be a valid YYYY-MM-DD value",
    });
  });
});

describe("GET /api/rider/wallet — automatic challenge bonuses", () => {
  it("locks a starter target and credits a completed challenge exactly once", async () => {
    const before = await fetchWallet();
    const firstDaily = before.todayChallenge as Record<string, unknown>;
    assert.equal(firstDaily.target, 10, "riders without prior-day activity receive the Bronze target");
    assert.equal(firstDaily.status, "active");

    const riderId = testRiderOid.toHexString();
    const now = new Date();
    await dbCol.orders().insertMany(
      walletOrderOids.map((oid, index) => ({
        _id: oid,
        riderId,
        status: "Delivered",
        billingMode: "prepaid",
        paymentType: "Online",
        orderTotal: 500,
        products: [],
        riderFare: 100,
        city: "TestCity",
        zone: "TestZone",
        createdAt: new Date(now.getTime() - (index + 10) * 60_000),
        updatedAt: now,
        pickUpTime: now.toISOString(),
      })),
    );

    const earned = await fetchWallet();
    const completedDaily = earned.todayChallenge as Record<string, unknown>;
    assert.equal(completedDaily.status, "completed");
    assert.equal(completedDaily.progress, 10);
    assert.equal(earned.challengeBonuses, 200);

    const refreshed = await fetchWallet();
    assert.equal(refreshed.challengeBonuses, 200, "a refresh must not duplicate the bonus");
    assert.equal(
      await dbCol.riderWalletEntries().countDocuments({
        riderId,
        type: "challenge_bonus",
        amount: 200,
      }),
      1,
      "one completed daily challenge creates exactly one wallet bonus entry",
    );

    const weekly = await dbCol.riderChallenges().findOne({
      riderId,
      kind: "weekly",
      status: "active",
    });
    assert.ok(weekly, "the generated weekly challenge should remain active");
    await dbCol.riderChallenges().updateOne(
      { _id: weekly!._id },
      { $set: { target: 10, reward: 500 } },
    );

    await Promise.all([fetchWallet(), fetchWallet()]);
    const settledWeekly = await dbCol.riderChallenges().findOne({ _id: weekly!._id });
    assert.equal(settledWeekly?.status, "completed");
    assert.equal(
      await dbCol.riderWalletEntries().countDocuments({
        challengeKey: `${riderId}:weekly:${String(weekly!.periodKey)}`,
      }),
      1,
      "simultaneous Wallet reads must produce one weekly bonus entry",
    );
  });
});

describe("GET /api/rider/wallet — missed period settlement", () => {
  it("settles earned daily and weekly challenges before expiring them", async () => {
    const riderId = testRiderOid.toHexString();
    const now = new Date();
    const pktMs = 5 * 60 * 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;
    const shifted = new Date(now.getTime() + pktMs);
    const todayStart = new Date(
      Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - pktMs,
    );
    const currentWeekStart = new Date(
      Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate() - shifted.getUTCDay(),
      ) - pktMs,
    );
    const dailyStart = new Date(todayStart.getTime() - dayMs);
    const weeklyStart = new Date(currentWeekStart.getTime() - 7 * dayMs);
    const dailyChallengeId = new ObjectId();
    const weeklyChallengeId = new ObjectId();
    const dailyOrderId = new ObjectId();
    const weeklyOrderId = new ObjectId();
    const dailyPeriodKey = `test-daily-${dailyStart.getTime()}`;
    const weeklyPeriodKey = `test-weekly-${weeklyStart.getTime()}`;
    const dailyKey = `${riderId}:daily:${dailyPeriodKey}`;
    const weeklyKey = `${riderId}:weekly:${weeklyPeriodKey}`;

    await dbCol.riderChallenges().insertMany([
      {
        _id: dailyChallengeId,
        riderId,
        kind: "daily",
        periodKey: dailyPeriodKey,
        weekKey: "test-expired",
        periodStart: dailyStart,
        periodEnd: todayStart,
        settlementGraceUntil: new Date(now.getTime() + dayMs),
        tier: "Bronze",
        target: 1,
        reward: 200,
        progress: 0,
        // Simulates the first boundary read expiring it before a delayed but
        // valid in-period order was visible to the challenge calculation.
        status: "expired",
        createdAt: dailyStart,
        updatedAt: dailyStart,
      },
      {
        _id: weeklyChallengeId,
        riderId,
        kind: "weekly",
        periodKey: weeklyPeriodKey,
        weekKey: "test-expired",
        periodStart: weeklyStart,
        periodEnd: currentWeekStart,
        settlementGraceUntil: new Date(now.getTime() + dayMs),
        tier: "60 deliveries",
        target: 1,
        reward: 500,
        progress: 0,
        status: "expired",
        createdAt: weeklyStart,
        updatedAt: weeklyStart,
      },
    ]);
    await dbCol.orders().insertMany([
      {
        _id: dailyOrderId,
        riderId,
        status: "Delivered",
        riderFare: 100,
        createdAt: new Date(dailyStart.getTime() + 60 * 60 * 1000),
      },
      {
        _id: weeklyOrderId,
        riderId,
        status: "Delivered",
        riderFare: 100,
        createdAt: new Date(weeklyStart.getTime() + 60 * 60 * 1000),
      },
    ]);

    await fetchWallet();

    assert.equal((await dbCol.riderChallenges().findOne({ _id: dailyChallengeId }))?.status, "completed");
    assert.equal((await dbCol.riderChallenges().findOne({ _id: weeklyChallengeId }))?.status, "completed");
    assert.ok(await dbCol.riderWalletEntries().findOne({ challengeKey: dailyKey }));
    assert.ok(await dbCol.riderWalletEntries().findOne({ challengeKey: weeklyKey }));

    await dbCol.orders().deleteMany({ _id: { $in: [dailyOrderId, weeklyOrderId] } });
    await dbCol.riderChallenges().deleteMany({ _id: { $in: [dailyChallengeId, weeklyChallengeId] } });
    await dbCol.riderWalletEntries().deleteMany({ challengeKey: { $in: [dailyKey, weeklyKey] } });
  });
});
