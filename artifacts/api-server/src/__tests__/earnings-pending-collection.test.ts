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
const walletOrderOids = Array.from({ length: 48 }, () => new ObjectId());
const fastDeliveryOrderOids = [
  new ObjectId(),
  new ObjectId(),
  new ObjectId(),
  new ObjectId(),
];

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
    _id: {
      $in: [
        ...testOrderOids,
        ...boundaryOrderOids,
        ...walletOrderOids,
        ...fastDeliveryOrderOids,
      ],
    },
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

async function pushRiderLocation(orderId: ObjectId, lat: number, lng: number) {
  const res = await fetch(`${serverUrl}/api/rider/location`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ orderId: orderId.toHexString(), lat, lng }),
  });
  assert.equal(res.status, 200, "Expected rider location update to succeed");
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
  it("advances sequential challenges without paying before the period ends", async () => {
    const before = await fetchWallet();
    const firstDaily = before.todayChallenge as Record<string, unknown>;
    const firstWeekly = before.weeklyChallenge as Record<string, unknown>;
    assert.equal(firstDaily.target, 10, "the first daily challenge requires 10 rides");
    assert.deepEqual(
      (firstDaily.milestones as Array<Record<string, unknown>>).map(({ target, reward }) => ({
        target,
        reward,
      })),
      [{ target: 10, reward: 200 }],
    );
    assert.deepEqual(
      (firstWeekly.milestones as Array<Record<string, unknown>>).map(({ target, reward }) => ({
        target,
        reward,
      })),
      [{ target: 50, reward: 500 }],
    );
    assert.equal(firstDaily.tier, "Challenge 1 of 5");
    assert.equal(firstDaily.status, "active");

    const riderId = testRiderOid.toHexString();
    const now = new Date();
    await dbCol.orders().insertMany(
      walletOrderOids.slice(0, 7).map((oid, index) => ({
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
    const dailyAfterTen = earned.todayChallenge as Record<string, unknown>;
    assert.equal(dailyAfterTen.status, "active");
    assert.equal(dailyAfterTen.target, 15);
    assert.equal(dailyAfterTen.progress, 0, "the 15-ride challenge starts from zero");
    assert.equal(dailyAfterTen.periodDeliveries, 10);
    assert.equal(dailyAfterTen.payoutStatus, "in_progress");
    assert.equal(dailyAfterTen.bonusAmount, 0);
    assert.equal(dailyAfterTen.tier, "Challenge 2 of 5");
    assert.equal(earned.challengeBonuses, 0, "reaching a target does not pay before day end");
    assert.equal(
      (earned.recentChallenges as Array<Record<string, unknown>>).some(
        (challenge) =>
          challenge.kind === "daily" &&
          challenge.periodStart === firstDaily.periodStart,
      ),
      false,
      "current-period intermediate stages must not appear as paid previous results",
    );

    const refreshed = await fetchWallet();
    assert.equal(refreshed.challengeBonuses, 0);
    const completedDaily = await dbCol.riderChallenges().findOne({
      riderId,
      kind: "daily",
      sequence: 0,
    });
    assert.ok(completedDaily, "the completed 10-ride challenge should exist");
    const activeSecondDaily = await dbCol.riderChallenges().findOne({
      riderId,
      kind: "daily",
      sequence: 1,
    });
    assert.ok(activeSecondDaily, "the 15-ride challenge should exist");
    assert.equal(activeSecondDaily!.basePeriodKey, completedDaily!.periodKey);
    assert.equal(
      activeSecondDaily!.periodKey,
      `${String(completedDaily!.periodKey)}:sequence:1`,
    );
    await assert.rejects(
      dbCol.riderChallenges().insertOne({
        riderId,
        kind: "daily",
        periodKey: completedDaily!.periodKey,
        status: "active",
      }),
      (error: any) => error?.code === 11000,
      "the legacy period key remains uniquely protected during mixed-writer rollout",
    );
    assert.equal(
      await dbCol.riderWalletEntries().countDocuments({
        challengeKey: `${riderId}:daily:${String(completedDaily!.periodKey)}:milestone:10`,
      }),
      0,
      "the 10-ride challenge must not create an early wallet bonus",
    );

    await dbCol.orders().insertMany(
      walletOrderOids.slice(7, 12).map((oid, index) => ({
        _id: oid,
        riderId,
        status: "Delivered",
        riderFare: 100,
        createdAt: new Date(now.getTime() - (index + 30) * 60_000),
      })),
    );
    const dailyAtFive = await fetchWallet();
    assert.equal((dailyAtFive.todayChallenge as Record<string, unknown>).target, 15);
    assert.equal((dailyAtFive.todayChallenge as Record<string, unknown>).progress, 5);
    assert.equal(dailyAtFive.challengeBonuses, 0);

    await dbCol.orders().insertMany(
      walletOrderOids.slice(12, 22).map((oid, index) => ({
        _id: oid,
        riderId,
        status: "Delivered",
        riderFare: 100,
        createdAt: new Date(now.getTime() - (index + 40) * 60_000),
      })),
    );
    const dailyAfterFifteenNewRides = await fetchWallet();
    assert.equal((dailyAfterFifteenNewRides.todayChallenge as Record<string, unknown>).target, 20);
    assert.equal((dailyAfterFifteenNewRides.todayChallenge as Record<string, unknown>).progress, 0);
    assert.equal(dailyAfterFifteenNewRides.challengeBonuses, 0);

    await dbCol.orders().deleteOne({ _id: walletOrderOids[21] });
    const afterDeletion = await fetchWallet();
    const dailyAfterDeletion = afterDeletion.todayChallenge as Record<string, unknown>;
    assert.equal(dailyAfterDeletion.target, 20);
    assert.equal(dailyAfterDeletion.progress, 0);
    assert.equal(afterDeletion.challengeBonuses, 0);

    const weekly = await dbCol.riderChallenges().findOne({
      riderId,
      kind: "weekly",
      status: "active",
    });
    assert.ok(weekly, "the generated weekly challenge should remain active");

    await dbCol.orders().insertMany(
      walletOrderOids.slice(22, 48).map((oid, index) => ({
        _id: oid,
        riderId,
        status: "Delivered",
        riderFare: 100,
        createdAt: new Date(now.getTime() - (index + 70) * 60_000),
      })),
    );

    await Promise.all([fetchWallet(), fetchWallet()]);
    const settledWeekly = await dbCol.riderChallenges().findOne({ _id: weekly!._id });
    assert.equal(settledWeekly?.status, "completed");
    assert.equal(
      await dbCol.riderWalletEntries().countDocuments({
        challengeKey: `${riderId}:weekly:${String(weekly!.periodKey)}:milestone:50`,
      }),
      0,
      "weekly milestones must not pay before week end",
    );
  });

  it("removes active challenge progress when the delivered order is deleted", async () => {
    const deletionRiderOid = new ObjectId();
    const riderId = deletionRiderOid.toHexString();
    const deletionOrderOid = new ObjectId();
    const phone = `03001112233__challenge_deletion_${riderId}`;
    const now = new Date();
    try {
      await dbCol.users().insertOne({
        _id: deletionRiderOid,
        type: "rider",
        name: "Test Rider (challenge deletion)",
        phone,
        password: "challenge-deletion-password",
        city: "TestCity",
        vehicleType: "bike",
        deleted: false,
        tillNoonFare: 100,
        createdAt: now,
        updatedAt: now,
      });
      await dbCol.orders().insertOne({
        _id: deletionOrderOid,
        riderId,
        status: "Delivered",
        riderFare: 100,
        createdAt: now,
      });

      const loginRes = await fetch(`${serverUrl}/api/rider/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password: "challenge-deletion-password" }),
      });
      assert.equal(loginRes.status, 200);
      const loginBody = (await loginRes.json()) as Record<string, unknown>;
      const headers = { Authorization: `Bearer ${String(loginBody.token)}` };
      const walletForDeletionRider = async () => {
        const response = await fetch(`${serverUrl}/api/rider/wallet`, { headers });
        assert.equal(response.status, 200);
        return response.json() as Promise<Record<string, unknown>>;
      };

      const counted = await walletForDeletionRider();
      assert.equal((counted.todayChallenge as Record<string, unknown>).progress, 1);
      assert.equal((counted.weeklyChallenge as Record<string, unknown>).progress, 1);

      await dbCol.orders().deleteOne({ _id: deletionOrderOid });
      const refreshed = await walletForDeletionRider();
      assert.equal((refreshed.todayChallenge as Record<string, unknown>).progress, 0);
      assert.equal((refreshed.weeklyChallenge as Record<string, unknown>).progress, 0);
    } finally {
      await dbCol.orders().deleteOne({ _id: deletionOrderOid });
      await dbCol.riderChallenges().deleteMany({ riderId });
      await dbCol.riderWalletEntries().deleteMany({ riderId });
      await dbCol.users().deleteOne({ _id: deletionRiderOid });
    }
  });

  it("uses rider delivery time for challenge periods with a legacy fallback", async () => {
    const deliveryTimeRiderOid = new ObjectId();
    const riderId = deliveryTimeRiderOid.toHexString();
    const phone = `03001112233__challenge_delivery_time_${riderId}`;
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const countedOrderId = new ObjectId();
    const excludedOrderId = new ObjectId();
    const legacyOrderId = new ObjectId();

    try {
      await dbCol.users().insertOne({
        _id: deliveryTimeRiderOid,
        type: "rider",
        name: "Test Rider (challenge delivery time)",
        phone,
        password: "challenge-delivery-time-password",
        city: "TestCity",
        vehicleType: "bike",
        deleted: false,
        tillNoonFare: 100,
        createdAt: now,
        updatedAt: now,
      });
      await dbCol.orders().insertMany([
        {
          _id: countedOrderId,
          riderId,
          status: "Delivered",
          riderFare: 100,
          createdAt: new Date(now.getTime() - 2 * dayMs),
          riderDeliveredAt: now,
        },
        {
          _id: excludedOrderId,
          riderId,
          status: "Delivered",
          riderFare: 100,
          createdAt: now,
          riderDeliveredAt: new Date(now.getTime() - 2 * dayMs),
        },
        {
          _id: legacyOrderId,
          riderId,
          status: "Delivered",
          riderFare: 100,
          createdAt: now,
        },
      ]);

      const loginRes = await fetch(`${serverUrl}/api/rider/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          password: "challenge-delivery-time-password",
        }),
      });
      assert.equal(loginRes.status, 200);
      const loginBody = (await loginRes.json()) as Record<string, unknown>;
      const walletRes = await fetch(`${serverUrl}/api/rider/wallet`, {
        headers: { Authorization: `Bearer ${String(loginBody.token)}` },
      });
      assert.equal(walletRes.status, 200);
      const wallet = (await walletRes.json()) as Record<string, unknown>;

      assert.equal(
        (wallet.todayChallenge as Record<string, unknown>).periodDeliveries,
        2,
        "delivery timestamp wins when present; createdAt is used only when it is missing",
      );
    } finally {
      await dbCol.orders().deleteMany({
        _id: { $in: [countedOrderId, excludedOrderId, legacyOrderId] },
      });
      await dbCol.riderChallenges().deleteMany({ riderId });
      await dbCol.riderWalletEntries().deleteMany({ riderId });
      await dbCol.users().deleteOne({ _id: deliveryTimeRiderOid });
    }
  });

  it("shows the highest completed current-period challenge as pending, not paid", async () => {
    const pendingRiderOid = new ObjectId();
    const riderId = pendingRiderOid.toHexString();
    const phone = `03001112233__challenge_pending_${riderId}`;
    const now = new Date();
    const orderIds = Array.from({ length: 225 }, () => new ObjectId());

    try {
      await dbCol.users().insertOne({
        _id: pendingRiderOid,
        type: "rider",
        name: "Test Rider (pending highest challenge)",
        phone,
        password: "challenge-pending-password",
        city: "TestCity",
        vehicleType: "bike",
        deleted: false,
        tillNoonFare: 100,
        createdAt: now,
        updatedAt: now,
      });
      await dbCol.orders().insertMany(
        orderIds.map((orderId, index) => ({
          _id: orderId,
          riderId,
          status: "Delivered",
          riderFare: 100,
          createdAt: new Date(now.getTime() - (index + 1) * 1_000),
        })),
      );

      const loginRes = await fetch(`${serverUrl}/api/rider/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          password: "challenge-pending-password",
        }),
      });
      assert.equal(loginRes.status, 200);
      const loginBody = (await loginRes.json()) as Record<string, unknown>;
      const walletRes = await fetch(`${serverUrl}/api/rider/wallet`, {
        headers: { Authorization: `Bearer ${String(loginBody.token)}` },
      });
      assert.equal(walletRes.status, 200);
      const wallet = (await walletRes.json()) as Record<string, unknown>;
      const daily = wallet.todayChallenge as Record<string, unknown>;
      const weekly = wallet.weeklyChallenge as Record<string, unknown>;

      assert.equal(daily.status, "completed");
      assert.equal(daily.payoutStatus, "pending");
      assert.equal(daily.bonusAmount, 0);
      assert.equal(daily.periodDeliveries, 225);
      assert.equal(weekly.status, "completed");
      assert.equal(weekly.payoutStatus, "pending");
      assert.equal(weekly.bonusAmount, 0);
      assert.equal(weekly.periodDeliveries, 225);
      assert.equal(wallet.challengeBonuses, 0);
      assert.equal(
        (wallet.recentChallenges as Array<Record<string, unknown>>).some(
          (challenge) =>
            challenge.periodStart === daily.periodStart ||
            challenge.periodStart === weekly.periodStart,
        ),
        false,
        "current-period final stages belong in active cards, not previous results",
      );
    } finally {
      await dbCol.orders().deleteMany({ _id: { $in: orderIds } });
      await dbCol.riderChallenges().deleteMany({ riderId });
      await dbCol.riderWalletEntries().deleteMany({ riderId });
      await dbCol.users().deleteOne({ _id: pendingRiderOid });
    }
  });

  it("migrates concurrently without paying retired cumulative targets from surplus rides", async () => {
    const migrationRiderOid = new ObjectId();
    const riderId = migrationRiderOid.toHexString();
    const migrationOrderOids = Array.from({ length: 20 }, () => new ObjectId());
    const phone = `03001112233__challenge_migration_${riderId}`;
    const now = new Date();

    try {
      await dbCol.users().insertOne({
        _id: migrationRiderOid,
        type: "rider",
        name: "Test Rider (challenge migration)",
        phone,
        password: "challenge-migration-password",
        city: "TestCity",
        vehicleType: "bike",
        deleted: false,
        tillNoonFare: 100,
        createdAt: now,
        updatedAt: now,
      });

      const loginRes = await fetch(`${serverUrl}/api/rider/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password: "challenge-migration-password" }),
      });
      assert.equal(loginRes.status, 200);
      const loginBody = (await loginRes.json()) as Record<string, unknown>;
      const headers = { Authorization: `Bearer ${String(loginBody.token)}` };
      const walletForMigrationRider = async () => {
        const response = await fetch(`${serverUrl}/api/rider/wallet`, { headers });
        assert.equal(response.status, 200);
        return response.json() as Promise<Record<string, unknown>>;
      };

      await walletForMigrationRider();
      const daily = await dbCol.riderChallenges().findOne({
        riderId,
        kind: "daily",
        sequence: 0,
      });
      assert.ok(daily);

      await dbCol.orders().insertMany(
        migrationOrderOids.map((orderId, index) => ({
          _id: orderId,
          riderId,
          status: "Delivered",
          riderFare: 100,
          createdAt: new Date(now.getTime() - (index + 1) * 60_000),
        })),
      );
      await dbCol.riderChallenges().updateOne(
        { _id: daily!._id },
        {
          $unset: {
            challengeMode: "",
            sequence: "",
            deliveryBaseline: "",
          },
          $set: {
            tier: "Daily delivery goals",
            target: 30,
            reward: 1000,
            milestones: [
              { target: 10, reward: 200 },
              { target: 15, reward: 200 },
              { target: 20, reward: 500 },
              { target: 25, reward: 800 },
              { target: 30, reward: 1000 },
            ],
            earnedMilestoneTargets: [10],
            progress: 20,
            status: "active",
          },
        },
      );

      const [migratedWallet, simultaneousWallet] = await Promise.all([
        walletForMigrationRider(),
        walletForMigrationRider(),
      ]);
      const activeDaily = migratedWallet.todayChallenge as Record<string, unknown>;
      assert.equal(activeDaily.target, 15);
      assert.equal(activeDaily.progress, 0);
      assert.equal(activeDaily.tier, "Challenge 2 of 5");
      assert.equal(migratedWallet.challengeBonuses, 200);
      assert.equal(
        (simultaneousWallet.todayChallenge as Record<string, unknown>).target,
        15,
      );
      assert.equal(simultaneousWallet.challengeBonuses, 200);
      assert.equal(
        await dbCol.riderWalletEntries().countDocuments({
          challengeKey: `${riderId}:daily:${String(daily!.periodKey)}:milestone:10`,
        }),
        1,
      );
      assert.equal(
        await dbCol.riderWalletEntries().countDocuments({
          challengeKey: {
            $in: [
              `${riderId}:daily:${String(daily!.periodKey)}:milestone:15`,
              `${riderId}:daily:${String(daily!.periodKey)}:milestone:20`,
            ],
          },
        }),
        0,
        "surplus legacy rides must not trigger the retired cumulative targets",
      );

      const migratedCompleted = await dbCol.riderChallenges().findOne({
        _id: daily!._id,
      });
      assert.equal(migratedCompleted?.status, "completed");
      assert.equal(migratedCompleted?.target, 10);
      assert.equal(migratedCompleted?.sequence, 0);
    } finally {
      await dbCol.orders().deleteMany({ _id: { $in: migrationOrderOids } });
      await dbCol.riderChallenges().deleteMany({ riderId });
      await dbCol.riderWalletEntries().deleteMany({ riderId });
      await dbCol.users().deleteOne({ _id: migrationRiderOid });
    }
  });
});

describe("GET /api/rider/wallet — missed period settlement", () => {
  it("pays only the highest daily and weekly challenge reached at period end", async () => {
    const settlementRiderOid = new ObjectId();
    const riderId = settlementRiderOid.toHexString();
    const phone = `03001112233__highest_settlement_${riderId}`;
    const now = new Date();
    const hourMs = 60 * 60 * 1000;
    const dayMs = 24 * hourMs;
    const periodEnd = new Date(now.getTime() - hourMs);
    const weeklyStart = new Date(periodEnd.getTime() - 7 * dayMs);
    const dailyStart = new Date(periodEnd.getTime() - dayMs);
    const weeklyPeriodKey = `test-highest-weekly-${weeklyStart.getTime()}`;
    const dailyPeriodKey = `test-highest-daily-${dailyStart.getTime()}`;
    const orderIds = Array.from({ length: 126 }, () => new ObjectId());
    const delayedOrderIds = Array.from({ length: 35 }, () => new ObjectId());

    try {
      await dbCol.users().insertOne({
        _id: settlementRiderOid,
        type: "rider",
        name: "Test Rider (highest settlement)",
        phone,
        password: "highest-settlement-password",
        city: "TestCity",
        vehicleType: "bike",
        deleted: false,
        tillNoonFare: 100,
        createdAt: now,
        updatedAt: now,
      });
      await dbCol.riderChallenges().insertMany([
        {
          riderId,
          kind: "daily",
          challengeMode: "sequential",
          sequence: 0,
          periodKey: dailyPeriodKey,
          basePeriodKey: dailyPeriodKey,
          weekKey: weeklyPeriodKey,
          periodStart: dailyStart,
          periodEnd,
          settlementGraceUntil: new Date(now.getTime() + dayMs),
          deliveryBaseline: 0,
          tier: "Challenge 1 of 5",
          target: 10,
          reward: 200,
          milestones: [{ target: 10, reward: 200 }],
          earnedMilestoneTargets: [],
          progress: 0,
          status: "active",
          createdAt: dailyStart,
          updatedAt: dailyStart,
        },
        {
          riderId,
          kind: "weekly",
          challengeMode: "sequential",
          sequence: 0,
          periodKey: weeklyPeriodKey,
          basePeriodKey: weeklyPeriodKey,
          weekKey: weeklyPeriodKey,
          periodStart: weeklyStart,
          periodEnd,
          settlementGraceUntil: new Date(now.getTime() + dayMs),
          deliveryBaseline: 0,
          tier: "Challenge 1 of 3",
          target: 50,
          reward: 500,
          milestones: [{ target: 50, reward: 500 }],
          earnedMilestoneTargets: [],
          progress: 0,
          status: "active",
          createdAt: weeklyStart,
          updatedAt: weeklyStart,
        },
      ]);
      await dbCol.orders().insertMany(
        orderIds.map((orderId, index) => ({
          _id: orderId,
          riderId,
          status: "Delivered",
          riderFare: 100,
          createdAt:
            index < 11
              ? new Date(dailyStart.getTime() + (index + 1) * 10 * 60_000)
              : new Date(weeklyStart.getTime() + (index - 10) * 30 * 60_000),
        })),
      );

      // Removing an eligible order before settlement leaves exactly 10 daily
      // and 125 weekly deliveries.
      await dbCol.orders().deleteOne({ _id: orderIds[0] });

      const loginRes = await fetch(`${serverUrl}/api/rider/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password: "highest-settlement-password" }),
      });
      assert.equal(loginRes.status, 200);
      const loginBody = (await loginRes.json()) as Record<string, unknown>;
      const headers = { Authorization: `Bearer ${String(loginBody.token)}` };
      const fetchSettlementWallet = async () => {
        const response = await fetch(`${serverUrl}/api/rider/wallet`, { headers });
        assert.equal(response.status, 200);
        return response.json() as Promise<Record<string, unknown>>;
      };

      const [settledWallet, simultaneousSettledWallet] = await Promise.all([
        fetchSettlementWallet(),
        fetchSettlementWallet(),
      ]);

      const dailySettlementKey = `${riderId}:daily:${dailyPeriodKey}:highest`;
      const weeklySettlementKey = `${riderId}:weekly:${weeklyPeriodKey}:highest`;
      const dailyEntry = await dbCol.riderWalletEntries().findOne({
        challengeKey: dailySettlementKey,
      });
      const weeklyEntry = await dbCol.riderWalletEntries().findOne({
        challengeKey: weeklySettlementKey,
      });
      assert.equal(dailyEntry?.milestoneTarget, 10);
      assert.equal(dailyEntry?.amount, 200);
      assert.equal(weeklyEntry?.milestoneTarget, 75);
      assert.equal(weeklyEntry?.amount, 1000);
      assert.equal(
        await dbCol.riderWalletEntries().countDocuments({
          riderId,
          type: "challenge_bonus",
        }),
        2,
        "each ended period creates exactly one highest-level reward",
      );
      assert.equal(
        await dbCol.riderWalletEntries().countDocuments({
          challengeKey: {
            $in: [
              `${riderId}:daily:${dailyPeriodKey}:milestone:10`,
              `${riderId}:weekly:${weeklyPeriodKey}:milestone:50`,
            ],
          },
        }),
        0,
        "lower completed challenges are skipped",
      );

      const dailyWinner = await dbCol.riderChallenges().findOne({
        riderId,
        kind: "daily",
        basePeriodKey: dailyPeriodKey,
        sequence: 0,
      });
      const weeklyWinner = await dbCol.riderChallenges().findOne({
        riderId,
        kind: "weekly",
        basePeriodKey: weeklyPeriodKey,
        sequence: 1,
      });
      assert.deepEqual(dailyWinner?.earnedMilestoneTargets, [10]);
      assert.deepEqual(weeklyWinner?.earnedMilestoneTargets, [75]);
      const recentResults = settledWallet.recentChallenges as Array<Record<string, unknown>>;
      const dailyResult = recentResults.find(
        (challenge) =>
          challenge.kind === "daily" &&
          challenge.periodStart === dailyStart.toISOString(),
      );
      const weeklyResult = recentResults.find(
        (challenge) =>
          challenge.kind === "weekly" &&
          challenge.periodStart === weeklyStart.toISOString(),
      );
      assert.equal(dailyResult?.payoutStatus, "paid");
      assert.equal(dailyResult?.bonusAmount, 200);
      assert.equal(dailyResult?.periodDeliveries, 10);
      assert.equal(weeklyResult?.payoutStatus, "paid");
      assert.equal(weeklyResult?.bonusAmount, 1000);
      assert.equal(weeklyResult?.periodDeliveries, 125);
      const simultaneousResults =
        simultaneousSettledWallet.recentChallenges as Array<Record<string, unknown>>;
      assert.equal(
        simultaneousResults.find(
          (challenge) =>
            challenge.kind === "daily" &&
            challenge.periodStart === dailyStart.toISOString(),
        )?.payoutStatus,
        "paid",
      );
      assert.equal(
        simultaneousResults.find(
          (challenge) =>
            challenge.kind === "weekly" &&
            challenge.periodStart === weeklyStart.toISOString(),
        )?.payoutStatus,
        "paid",
      );

      await dbCol.orders().insertMany(
        delayedOrderIds.slice(0, 15).map((orderId, index) => ({
          _id: orderId,
          riderId,
          status: "Delivered",
          riderFare: 100,
          createdAt: new Date(dailyStart.getTime() + (index + 30) * 10 * 60_000),
        })),
      );
      await fetchSettlementWallet();
      const sameValueUpgrade = await dbCol.riderWalletEntries().findOne({
        challengeKey: dailySettlementKey,
      });
      assert.equal(sameValueUpgrade?.milestoneTarget, 15);
      assert.equal(sameValueUpgrade?.challengeSequence, 1);
      assert.equal(sameValueUpgrade?.amount, 200);

      await dbCol.orders().insertMany(
        delayedOrderIds.slice(15).map((orderId, index) => ({
          _id: orderId,
          riderId,
          status: "Delivered",
          riderFare: 100,
          createdAt: new Date(dailyStart.getTime() + (index + 50) * 10 * 60_000),
        })),
      );
      await fetchSettlementWallet();
      const upgradedDailyEntry = await dbCol.riderWalletEntries().findOne({
        challengeKey: dailySettlementKey,
      });
      assert.equal(upgradedDailyEntry?.milestoneTarget, 20);
      assert.equal(upgradedDailyEntry?.challengeSequence, 2);
      assert.equal(upgradedDailyEntry?.amount, 500);

      await dbCol.orders().deleteMany({ _id: { $in: delayedOrderIds } });
      await fetchSettlementWallet();
      const permanentDailyEntry = await dbCol.riderWalletEntries().findOne({
        challengeKey: dailySettlementKey,
      });
      assert.equal(permanentDailyEntry?.milestoneTarget, 20);
      assert.equal(permanentDailyEntry?.challengeSequence, 2);
      assert.equal(permanentDailyEntry?.amount, 500);
      assert.equal(
        await dbCol.riderWalletEntries().countDocuments({
          riderId,
          type: "challenge_bonus",
        }),
        2,
        "grace-period upgrades and rereads do not duplicate settled bonuses",
      );
    } finally {
      await dbCol.orders().deleteMany({ _id: { $in: orderIds } });
      await dbCol.orders().deleteMany({ _id: { $in: delayedOrderIds } });
      await dbCol.riderChallenges().deleteMany({ riderId });
      await dbCol.riderWalletEntries().deleteMany({ riderId });
      await dbCol.users().deleteOne({ _id: settlementRiderOid });
    }
  });

  it("does not add a highest-only payout to legacy milestone history", async () => {
    const legacyRiderOid = new ObjectId();
    const riderId = legacyRiderOid.toHexString();
    const challengeId = new ObjectId();
    const phone = `03001112233__legacy_settlement_${riderId}`;
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const periodEnd = new Date(now.getTime() - 60 * 60 * 1000);
    const periodStart = new Date(periodEnd.getTime() - dayMs);
    const periodKey = `test-legacy-settlement-${periodStart.getTime()}`;
    const orderIds = Array.from({ length: 15 }, () => new ObjectId());
    const milestoneKeys = [
      `${riderId}:daily:${periodKey}:milestone:10`,
      `${riderId}:daily:${periodKey}:milestone:15`,
      `${riderId}:daily:${periodKey}:milestone:20`,
      `${riderId}:daily:${periodKey}:milestone:25`,
      `${riderId}:daily:${periodKey}:milestone:30`,
      `${riderId}:daily:${periodKey}:milestone:35`,
    ];

    try {
      await dbCol.users().insertOne({
        _id: legacyRiderOid,
        type: "rider",
        name: "Test Rider (legacy settlement)",
        phone,
        password: "legacy-settlement-password",
        city: "TestCity",
        vehicleType: "bike",
        deleted: false,
        tillNoonFare: 100,
        createdAt: now,
        updatedAt: now,
      });
      await dbCol.riderChallenges().insertOne({
        _id: challengeId,
        riderId,
        kind: "daily",
        periodKey,
        weekKey: "test-legacy-week",
        periodStart,
        periodEnd,
        settlementGraceUntil: new Date(now.getTime() + dayMs),
        tier: "Daily delivery goals",
        target: 30,
        reward: 1000,
        milestones: [
          { target: 10, reward: 200 },
          { target: 15, reward: 200 },
          { target: 20, reward: 500 },
          { target: 25, reward: 800 },
          { target: 30, reward: 1000 },
          { target: 35, reward: 1200 },
        ],
        earnedMilestoneTargets: [10, 15, 35],
        progress: 35,
        status: "completed",
        createdAt: periodStart,
        updatedAt: periodStart,
      });
      await dbCol.orders().insertMany(
        orderIds.map((orderId, index) => ({
          _id: orderId,
          riderId,
          status: "Delivered",
          riderFare: 100,
          createdAt: new Date(periodStart.getTime() + (index + 1) * 10 * 60_000),
        })),
      );
      await dbCol.riderWalletEntries().insertMany([
        {
          riderId,
          challengeKey: milestoneKeys[0],
          weekKey: "test-legacy-week",
          milestoneTarget: 10,
          type: "challenge_bonus",
          amount: 200,
          title: "Daily challenge · Goal #1 (10 deliveries)",
          createdAt: periodStart,
        },
        {
          riderId,
          challengeKey: milestoneKeys[1],
          weekKey: "test-legacy-week",
          milestoneTarget: 15,
          type: "challenge_bonus",
          amount: 200,
          title: "Daily challenge · Goal #2 (15 deliveries)",
          createdAt: periodStart,
        },
        {
          riderId,
          challengeKey: milestoneKeys[2],
          weekKey: "test-legacy-week",
          milestoneTarget: 20,
          type: "challenge_bonus",
          amount: 500,
          title: "Daily challenge · Goal #3 (20 deliveries)",
          createdAt: periodStart,
        },
        {
          riderId,
          challengeKey: milestoneKeys[3],
          weekKey: "test-legacy-week",
          milestoneTarget: 25,
          type: "challenge_bonus",
          amount: 800,
          title: "Daily challenge · Goal #4 (25 deliveries)",
          createdAt: periodStart,
        },
        {
          riderId,
          challengeKey: milestoneKeys[4],
          weekKey: "test-legacy-week",
          milestoneTarget: 30,
          type: "challenge_bonus",
          amount: 1000,
          title: "Daily challenge · Goal #5 (30 deliveries)",
          createdAt: periodStart,
        },
        {
          riderId,
          challengeKey: milestoneKeys[5],
          weekKey: "test-legacy-week",
          milestoneTarget: 35,
          type: "challenge_bonus",
          amount: 1200,
          title: "Daily challenge · Retired goal (35 deliveries)",
          createdAt: periodStart,
        },
      ]);

      const loginRes = await fetch(`${serverUrl}/api/rider/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password: "legacy-settlement-password" }),
      });
      assert.equal(loginRes.status, 200);
      const loginBody = (await loginRes.json()) as Record<string, unknown>;
      const walletRes = await fetch(`${serverUrl}/api/rider/wallet`, {
        headers: { Authorization: `Bearer ${String(loginBody.token)}` },
      });
      assert.equal(walletRes.status, 200);
      const wallet = (await walletRes.json()) as Record<string, unknown>;

      assert.equal(
        await dbCol.riderWalletEntries().countDocuments({
          riderId,
          type: "challenge_bonus",
        }),
        6,
        "legacy milestone rewards remain unchanged",
      );
      assert.equal(
        await dbCol.riderWalletEntries().countDocuments({
          challengeKey: `${riderId}:daily:${periodKey}:highest`,
        }),
        0,
        "legacy history must not receive a second highest-only payout",
      );
      const legacyResult = (
        wallet.recentChallenges as Array<Record<string, unknown>>
      ).find((challenge) => challenge.id === challengeId.toHexString());
      assert.equal(legacyResult?.payoutStatus, "paid");
      assert.equal(legacyResult?.bonusAmount, 3900);
    } finally {
      await dbCol.orders().deleteMany({ _id: { $in: orderIds } });
      await dbCol.riderChallenges().deleteMany({ riderId });
      await dbCol.riderWalletEntries().deleteMany({ riderId });
      await dbCol.users().deleteOne({ _id: legacyRiderOid });
    }
  });

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

  it("expires an old active challenge without paying it after the grace window", async () => {
    const riderId = testRiderOid.toHexString();
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const periodEnd = new Date(now.getTime() - 2 * dayMs);
    const periodStart = new Date(periodEnd.getTime() - dayMs);
    const challengeId = new ObjectId();
    const orderId = new ObjectId();
    const periodKey = `test-beyond-grace-${periodEnd.getTime()}`;
    const challengeKey = `${riderId}:daily:${periodKey}`;

    try {
      await dbCol.riderChallenges().insertOne({
        _id: challengeId,
        riderId,
        kind: "daily",
        periodKey,
        weekKey: "test-beyond-grace",
        periodStart,
        periodEnd,
        settlementGraceUntil: new Date(now.getTime() - dayMs),
        tier: "Legacy challenge",
        target: 1,
        reward: 200,
        progress: 0,
        status: "active",
        createdAt: periodStart,
        updatedAt: periodStart,
      });
      await dbCol.orders().insertOne({
        _id: orderId,
        riderId,
        status: "Delivered",
        riderFare: 100,
        createdAt: new Date(periodStart.getTime() + 60 * 60 * 1000),
      });

      const wallet = await fetchWallet();

      const expired = await dbCol.riderChallenges().findOne({ _id: challengeId });
      assert.equal(expired?.status, "expired");
      assert.equal(
        await dbCol.riderWalletEntries().countDocuments({ challengeKey }),
        0,
      );
      const missedResult = (
        wallet.recentChallenges as Array<Record<string, unknown>>
      ).find((challenge) => challenge.id === challengeId.toHexString());
      assert.equal(missedResult?.payoutStatus, "not_earned");
      assert.equal(missedResult?.bonusAmount, 0);
      assert.equal(missedResult?.periodDeliveries, 0);
    } finally {
      await dbCol.orders().deleteOne({ _id: orderId });
      await dbCol.riderChallenges().deleteOne({ _id: challengeId });
      await dbCol.riderWalletEntries().deleteMany({ challengeKey });
    }
  });

  it("shows one result for a multi-stage sequential period first opened after grace", async () => {
    const riderId = testRiderOid.toHexString();
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const periodEnd = new Date(now.getTime() - 2 * dayMs);
    const periodStart = new Date(periodEnd.getTime() - dayMs);
    const periodKey = `test-post-grace-chain-${periodEnd.getTime()}`;
    const challengeIds = [new ObjectId(), new ObjectId()];
    const orderIds = Array.from({ length: 14 }, () => new ObjectId());

    try {
      await dbCol.riderChallenges().insertMany([
        {
          _id: challengeIds[0],
          riderId,
          kind: "daily",
          challengeMode: "sequential",
          sequence: 0,
          periodKey,
          basePeriodKey: periodKey,
          weekKey: "test-post-grace-chain",
          periodStart,
          periodEnd,
          settlementGraceUntil: new Date(now.getTime() - dayMs),
          deliveryBaseline: 0,
          tier: "Challenge 1 of 5",
          target: 10,
          reward: 200,
          milestones: [{ target: 10, reward: 200 }],
          earnedMilestoneTargets: [10],
          progress: 10,
          status: "completed",
          createdAt: periodStart,
          updatedAt: periodStart,
        },
        {
          _id: challengeIds[1],
          riderId,
          kind: "daily",
          challengeMode: "sequential",
          sequence: 1,
          periodKey: `${periodKey}:sequence:1`,
          basePeriodKey: periodKey,
          weekKey: "test-post-grace-chain",
          periodStart,
          periodEnd,
          settlementGraceUntil: new Date(now.getTime() - dayMs),
          deliveryBaseline: 10,
          tier: "Challenge 2 of 5",
          target: 15,
          reward: 200,
          milestones: [{ target: 15, reward: 200 }],
          earnedMilestoneTargets: [],
          progress: 4,
          status: "active",
          createdAt: new Date(periodStart.getTime() + 60_000),
          updatedAt: new Date(periodStart.getTime() + 60_000),
        },
      ]);
      await dbCol.orders().insertMany(
        orderIds.map((orderId, index) => ({
          _id: orderId,
          riderId,
          status: "Delivered",
          riderFare: 100,
          createdAt:
            index < 7
              ? new Date(periodStart.getTime() - dayMs)
              : new Date(periodStart.getTime() + (index + 1) * 60_000),
          ...(index < 7
            ? {
                riderDeliveredAt: new Date(
                  periodStart.getTime() + (index + 1) * 60_000,
                ),
              }
            : {}),
        })),
      );

      const wallet = await fetchWallet();
      const periodResults = (
        wallet.recentChallenges as Array<Record<string, unknown>>
      ).filter(
        (challenge) =>
          challenge.kind === "daily" &&
          challenge.periodStart === periodStart.toISOString(),
      );

      assert.equal(periodResults.length, 1);
      assert.equal(periodResults[0]?.id, challengeIds[0].toHexString());
      assert.equal(periodResults[0]?.payoutStatus, "not_earned");
      assert.equal(periodResults[0]?.bonusAmount, 0);
      assert.equal(periodResults[0]?.periodDeliveries, 14);
      assert.equal(
        await dbCol.riderChallenges().countDocuments({
          _id: { $in: challengeIds },
          settlementSkipped: false,
        }),
        1,
      );
    } finally {
      await dbCol.orders().deleteMany({ _id: { $in: orderIds } });
      await dbCol.riderChallenges().deleteMany({ _id: { $in: challengeIds } });
      await dbCol.riderWalletEntries().deleteMany({
        riderId,
        challengeId: { $in: challengeIds.map(String) },
      });
    }
  });
});

describe("Fast delivery bonuses", () => {
  it("credits Rs. 50 exactly once when an accepted order is delivered within 20 minutes", async () => {
    const riderId = testRiderOid.toHexString();
    const [fastOrderId, lateOrderId] = fastDeliveryOrderOids;
    const now = new Date();
    const baseOrder = {
      riderId,
      billingMode: "prepaid",
      paymentType: "Online",
      orderTotal: 500,
      products: [],
      riderFare: 100,
      city: "TestCity",
      zone: "TestZone",
      latitude: 31.5204,
      longitude: 74.3587,
      riderArrived: true,
      pickUpTime: "12:00:00",
      createdAt: now,
      updatedAt: now,
    };

    await dbCol.orders().insertMany([
      {
        ...baseOrder,
        _id: fastOrderId,
        orderNum: "FAST-DELIVERY-TEST",
        status: "Rider Picked Up",
        acceptedTime: new Date(now.getTime() - 19 * 60_000),
      },
      {
        ...baseOrder,
        _id: lateOrderId,
        orderNum: "LATE-DELIVERY-TEST",
        status: "Rider Picked Up",
        acceptedTime: new Date(now.getTime() - 25 * 60_000),
      },
    ]);

    for (const orderId of [fastOrderId, lateOrderId]) {
      await pushRiderLocation(orderId, 31.5204, 74.3587);
      const delivered = await fetch(`${serverUrl}/api/rider/orders/${orderId}/status`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "Delivered" }),
      });
      assert.equal(delivered.status, 200);
    }

    const fastOrder = await dbCol.orders().findOne({ _id: fastOrderId });
    assert.ok(fastOrder?.riderDeliveredAt, "delivery stores a server timestamp for bonus eligibility");

    const wallet = await fetchWallet();
    assert.equal(wallet.fastDeliveryBonuses, 50);
    assert.equal(wallet.totalEarnings, Number(wallet.deliveryEarnings) + Number(wallet.challengeBonuses) + 50);
    assert.ok(
      (wallet.transactions as Array<Record<string, unknown>>).some(
        (entry) =>
          entry.type === "fast_delivery_bonus" &&
          entry.amount === 50 &&
          entry.orderId === fastOrderId.toHexString(),
      ),
      "Wallet includes a fast-delivery bonus transaction for the eligible order",
    );

    await fetchWallet();
    assert.equal(
      await dbCol.riderWalletEntries().countDocuments({
        entryKey: `fast_delivery:${riderId}:${fastOrderId.toHexString()}`,
      }),
      1,
      "repeated Wallet reads must not duplicate a fast-delivery bonus",
    );
    assert.equal(
      await dbCol.riderWalletEntries().countDocuments({
        entryKey: `fast_delivery:${riderId}:${lateOrderId.toHexString()}`,
      }),
      0,
      "orders completed after 20 minutes must not receive the bonus",
    );

    await dbCol.orders().deleteMany({ _id: { $in: [fastOrderId, lateOrderId] } });
    await dbCol.riderWalletEntries().deleteMany({
      entryKey: {
        $in: [
          `fast_delivery:${riderId}:${fastOrderId.toHexString()}`,
          `fast_delivery:${riderId}:${lateOrderId.toHexString()}`,
        ],
      },
    });
  });

  it("completes delivery but skips the bonus when the rider is more than 20 meters away", async () => {
    const riderId = testRiderOid.toHexString();
    const farOrderId = fastDeliveryOrderOids[3];
    const now = new Date();
    await dbCol.orders().insertOne({
      _id: farOrderId,
      riderId,
      orderNum: "FAR-DELIVERY-TEST",
      status: "Rider Picked Up",
      billingMode: "prepaid",
      paymentType: "Online",
      orderTotal: 500,
      products: [],
      riderFare: 100,
      city: "TestCity",
      zone: "TestZone",
      latitude: 31.5204,
      longitude: 74.3587,
      acceptedTime: new Date(now.getTime() - 10 * 60_000),
      riderArrived: true,
      pickUpTime: "12:00:00",
      createdAt: now,
      updatedAt: now,
    });
    await pushRiderLocation(farOrderId, 31.5214, 74.3587);

    const delivered = await fetch(`${serverUrl}/api/rider/orders/${farOrderId}/status`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "Delivered" }),
    });
    assert.equal(delivered.status, 200);
    assert.equal(
      (await dbCol.orders().findOne({ _id: farOrderId }))?.status,
      "Delivered",
      "delivery must still complete when the rider is outside the bonus geofence",
    );
    assert.equal(
      await dbCol.riderWalletEntries().countDocuments({
        entryKey: `fast_delivery:${riderId}:${farOrderId.toHexString()}`,
      }),
      0,
      "a blocked delivery must not receive a fast-delivery bonus",
    );

    await dbCol.orders().deleteOne({ _id: farOrderId });
  });

  it("does not backfill a bonus for an order that was already delivered", async () => {
    const riderId = testRiderOid.toHexString();
    const recoveryOrderId = fastDeliveryOrderOids[2];
    const now = new Date();

    await dbCol.orders().insertOne({
      _id: recoveryOrderId,
      riderId,
      status: "Delivered",
      billingMode: "prepaid",
      paymentType: "Online",
      orderTotal: 500,
      products: [],
      riderFare: 100,
      city: "TestCity",
      zone: "TestZone",
      createdAt: new Date(now.getTime() - 10 * 60_000),
      acceptedTime: new Date(now.getTime() - 10 * 60_000),
      riderDeliveredAt: now,
      updatedAt: now,
    });

    const wallet = await fetchWallet();
    assert.equal(wallet.fastDeliveryBonuses, 0);
    assert.equal(
      (wallet.transactions as Array<Record<string, unknown>>).some(
        (entry) =>
          entry.type === "fast_delivery_bonus" &&
          entry.orderId === recoveryOrderId.toHexString(),
      ),
      false,
      "Wallet must not backfill a bonus for an already-delivered order",
    );

    await dbCol.orders().deleteOne({ _id: recoveryOrderId });
    await dbCol.riderWalletEntries().deleteOne({
      entryKey: `fast_delivery:${riderId}:${recoveryOrderId.toHexString()}`,
    });
  });
});
