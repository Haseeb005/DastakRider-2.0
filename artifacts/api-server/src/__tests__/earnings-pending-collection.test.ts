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
