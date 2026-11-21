import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import {
  createRiderLocationHandlers,
  isFreshRiderLocationTime,
  mongoOrderId,
  parseCapturedAt,
  MAX_LOCATION_AGE_MS,
  RIDER_LOCATION_TTL_MS,
} from "../lib/riderLocationHandlers";

// Deliberately no GPS fixtures: these tests never invent or publish a position.
const orderId = "abcdef0123456789abcdef01";
function fixture({ authenticated = true, order = null as any, entry = null as any } = {}) {
  const orderQueries: any[] = [];
  const locationQueries: any[] = [];
  let writes = 0;
  const handlers = createRiderLocationHandlers({
    requireRiderId: (_req, res) => {
      if (authenticated) return "assigned-rider";
      res.status(401).json({ message: "Rider not logged in" });
      return null;
    },
    orders: () => ({
      findOne: async (query: any) => {
        orderQueries.push(query);
        if (query.riderId && order?.riderId && order.riderId !== query.riderId) return null;
        if (query.status && order?.status !== query.status) return null;
        if (query._id && order?._id && !query._id.equals(order._id)) return null;
        return order;
      },
    }) as any,
    locations: () => ({
      findOne: async (query: any) => { locationQueries.push(query); return entry; },
      updateOne: async () => { writes++; throw new Error("No GPS writes allowed in these tests"); },
    }) as any,
  });
  const res = {
    code: 200, body: undefined as any, headers: {} as Record<string, string>,
    status(code: number) { this.code = code; return this; },
    json(body: any) { this.body = body; return this; },
    setHeader(key: string, value: string) { this.headers[key] = value; },
  };
  return { handlers, res, orderQueries, locationQueries, writes: () => writes };
}

test("only canonical Mongo _id strings are accepted, including uppercase input", () => {
  assert.equal(mongoOrderId(orderId.toUpperCase())?.toHexString(), orderId);
  for (const value of ["6", "55", "", null, {}, new ObjectId(orderId)]) {
    assert.equal(mongoOrderId(value), null);
  }
});

test("five-minute freshness matches customer reader; missing and future times fail closed", () => {
  const now = Date.now();
  assert.equal(isFreshRiderLocationTime(new Date(now), now), true);
  assert.equal(isFreshRiderLocationTime(new Date(now - RIDER_LOCATION_TTL_MS), now), true);
  for (const value of [null, undefined, "", "invalid", new Date(now + 1), new Date(now - RIDER_LOCATION_TTL_MS - 1)]) {
    assert.equal(isFreshRiderLocationTime(value, now), false);
  }
});

test("capturedAt is required and bounded by the server freshness window", () => {
  const now = Date.now();
  assert.equal(parseCapturedAt(new Date(now).toISOString(), now)?.getTime(), now);
  for (const value of [
    null,
    0,
    "invalid",
    new Date(now - MAX_LOCATION_AGE_MS - 1).toISOString(),
    new Date(now + 6_000).toISOString(),
  ]) {
    assert.equal(parseCapturedAt(value, now), null);
  }
});

test("unauthenticated publishing and reads never access the database", async () => {
  const f = fixture({ authenticated: false });
  await f.handlers.publish({ body: { orderId } }, f.res);
  assert.equal(f.res.code, 401);
  await f.handlers.read({ params: { orderId } }, f.res);
  assert.equal(f.res.code, 401);
  assert.deepEqual(f.orderQueries, []);
  assert.deepEqual(f.locationQueries, []);
  assert.equal(f.writes(), 0);
});

test("a different rider cannot publish for an assigned rider's order", async () => {
  const f = fixture({
    order: {
      _id: new ObjectId(orderId),
      riderId: "another-rider",
      status: "Rider Picked Up",
    },
  });
  await f.handlers.publish({
    body: {
      orderId,
      capturedAt: new Date().toISOString(),
    },
  }, f.res);
  assert.equal(f.res.code, 403);
  assert.deepEqual(f.orderQueries[0], {
    _id: new ObjectId(orderId), riderId: "assigned-rider", status: "Rider Picked Up",
  });
  assert.equal(f.writes(), 0);
});

test("request body cannot override verified rider identity", async () => {
  const f = fixture();
  await f.handlers.publish({
    body: {
      orderId: orderId.toUpperCase(),
      capturedAt: new Date().toISOString(),
      riderId: "spoofed-rider",
    },
  }, f.res);
  assert.equal(f.res.code, 403);
  assert.deepEqual(f.orderQueries[0], {
    _id: new ObjectId(orderId), riderId: "assigned-rider", status: "Rider Picked Up",
  });
  assert.equal(f.writes(), 0);
});

test("missing coordinates cannot be persisted even for an assigned rider", async () => {
  const f = fixture({
    order: {
      _id: new ObjectId(orderId),
      riderId: "assigned-rider",
      status: "Rider Picked Up",
    },
  });
  await f.handlers.publish({
    body: { orderId, capturedAt: new Date().toISOString() },
  }, f.res);
  assert.equal(f.res.code, 400);
  assert.equal(f.writes(), 0);
});

test("completed deliveries are rejected before any location write", async () => {
  const f = fixture({
    order: {
      _id: new ObjectId(orderId),
      riderId: "assigned-rider",
      status: "Delivered",
    },
  });
  await f.handlers.publish({
    body: { orderId, capturedAt: new Date().toISOString() },
  }, f.res);
  assert.equal(f.res.code, 403);
  assert.deepEqual(f.orderQueries[0], {
    _id: new ObjectId(orderId), riderId: "assigned-rider", status: "Rider Picked Up",
  });
  assert.equal(f.writes(), 0);
});

test("unassigned read is hidden; completed deliveries never read coordinates", async () => {
  const denied = fixture();
  await denied.handlers.read({ params: { orderId } }, denied.res);
  assert.equal(denied.res.code, 404);
  const delivered = fixture({ order: { status: "Delivered" } });
  await delivered.handlers.read({ params: { orderId } }, delivered.res);
  assert.equal(delivered.res.body, null);
  assert.deepEqual(delivered.locationQueries, []);
});

test("tracking reads shared collection by canonical orderId and verified rider, not memory", async () => {
  const f = fixture({ order: { status: "Rider Picked Up" } });
  await f.handlers.read({ params: { orderId: orderId.toUpperCase() } }, f.res);
  assert.equal(f.res.body, null);
  assert.deepEqual(f.locationQueries, [{ orderId, riderId: "assigned-rider" }]);
  assert.equal(f.res.headers["Cache-Control"], "private, no-store");
});

test("stale and malformed stored records return null, never an invented fallback", async () => {
  for (const entry of [
    { updatedAt: new Date(Date.now() - RIDER_LOCATION_TTL_MS - 1) },
    { updatedAt: new Date() },
  ]) {
    const f = fixture({ order: { status: "Rider Picked Up" }, entry });
    await f.handlers.read({ params: { orderId } }, f.res);
    assert.equal(f.res.body, null);
  }
});
