import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { ObjectId } from "mongodb";
import { usersCol, ordersCol } from "../lib/mongo";

const router = Router();

// ---------------------------------------------------------------------------
// Bearer-token auth (additive — for the Expo mobile app).
// Web clients keep using the existing session cookie. Mobile clients cannot
// rely on cookies, so login/register also return an HMAC-signed token that
// encodes the riderId. The token is verified on each request as a fallback
// when no session riderId is present. No DB writes — purely stateless.
// ---------------------------------------------------------------------------
const TOKEN_SECRET: string =
  process.env.SESSION_SECRET ??
  (() => {
    throw new Error(
      "SESSION_SECRET is required to sign/verify rider bearer tokens",
    );
  })();

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signToken(riderId: string): string {
  const payload = b64url(Buffer.from(riderId, "utf8"));
  const sig = b64url(crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest());
  return `${payload}.${sig}`;
}

function verifyToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = b64url(crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return null;
  }
}

function bearerRiderId(req: any): string {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (typeof h !== "string" || !h.toLowerCase().startsWith("bearer ")) return "";
  const token = h.slice(7).trim();
  if (!token) return "";
  return verifyToken(token) || "";
}

// Real order status flow in the Dastak database:
//   Pending -> Admin Accepted -> Rider Accepted -> Rider Picked Up -> Delivered  (or Rejected)
// An order only becomes visible to riders once the admin has accepted it
// ("Admin Accepted"). That is the trigger for the available list + new-order alert.
const ACTIVE_STATUSES = ["Rider Accepted", "Rider Picked Up"];
const AVAILABLE_STATUS = "Admin Accepted";
const DELIVERED_STATUS = "Delivered";
const COD_TYPES = ["COD", "Cash", "cash", "cod"];

function normPhone(phone: any): string {
  return String(phone).replace(/[\s\-()]/g, "");
}

// Passwords in the legacy DB are mostly plaintext, a few are bcrypt-hashed.
async function checkPassword(input: string, stored: any): Promise<boolean> {
  if (typeof stored !== "string" || stored.length === 0) return false;
  if (stored.startsWith("$2")) {
    try {
      return await bcrypt.compare(input, stored);
    } catch {
      return false;
    }
  }
  return input === stored;
}

function isDeleted(user: any): boolean {
  return user?.deleted === true || user?.deleted === "true";
}

function getRiderId(req: any): string {
  return (req.session as any)?.riderId || bearerRiderId(req) || "";
}

function requireRiderId(req: any, res: any): string | null {
  const id = getRiderId(req);
  if (!id) {
    res.status(401).json({ message: "Rider not logged in" });
    return null;
  }
  return id;
}

async function findRiderById(id: string) {
  let _id: ObjectId;
  try {
    _id = new ObjectId(id);
  } catch {
    return null;
  }
  return usersCol().findOne({ _id, type: "rider" });
}

function riderRating(user: any): { rating: number; ratingCount: number } {
  const rating = Number(user?.rating) || 0;
  const ratingCount = Array.isArray(user?.reviews)
    ? user.reviews.length
    : Number(user?.ratingCount) || 0;
  return { rating, ratingCount };
}

function safeRider(user: any) {
  const { rating, ratingCount } = riderRating(user);
  return {
    id: String(user._id),
    name: user.name || null,
    phone: user.phone || null,
    city: user.city || null,
    vehicleType: user.vehicleType || "bike",
    isOnline: !!user.isOnline,
    totalEarnings: 0,
    totalDeliveries: Number(user.orderCount) || 0,
    rating,
    ratingCount,
    riderZones: Array.isArray(user.riderZones) ? user.riderZones.filter(Boolean) : [],
    pendingCollection: Number(user.pendingCollection) || 0,
    unpaidCollection: Number(user.unpaidCollection) || 0,
    tillNoonFare: Number(user.tillNoonFare) || 0,
  };
}

// ── Pakistan timezone helpers (UTC+5) ──────────────────────────────────────────
// Start-of-period returned as a real UTC instant aligned to the PKT calendar, so
// comparisons against stored timestamps are correct for PK.
// NOTE: period filtering uses `createdAt`, NOT `updatedAt` — every delivered order
// in the shared prod DB shares one bulk-written `updatedAt`, so filtering on it
// puts everything in "today" and makes Today/Week/Month all equal the overall total.
const PKT_MS = 5 * 60 * 60 * 1000;

function pktPeriodStart(kind: "day" | "week" | "month"): Date {
  const shifted = new Date(Date.now() + PKT_MS); // read PKT wall clock via UTC getters
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  const dow = shifted.getUTCDay();
  let day = d;
  if (kind === "week") day = d - dow;
  if (kind === "month") day = 1;
  // PKT midnight of that calendar date == that UTC midnight minus 5h.
  return new Date(Date.UTC(y, m, day) - PKT_MS);
}

// Aggregate a rider's delivered-order earnings into total / today / week / month
// buckets, plus COD-only cash collected. Pay per delivered order is the rider's
// CURRENT tillNoonFare (passed in); the per-order snapshot (riderFare) is only a
// fallback for riders with no tillNoonFare. Never the customer's deliveryCharges.
// Shared by /rider/me and /rider/earnings.
async function computeEarnings(riderId: string, tillNoonFare = 0) {
  const dayStart = pktPeriodStart("day");
  const weekStart = pktPeriodStart("week");
  const monthStart = pktPeriodStart("month");

  // Use the rider's current tillNoonFare per delivered order when set; otherwise
  // fall back to that order's stored snapshot. Never the customer's deliveryCharges.
  const snapshotExpr = {
    $convert: {
      input: { $ifNull: ["$riderFare", 0] },
      to: "double",
      onError: 0,
      onNull: 0,
    },
  };
  const fareExpr =
    tillNoonFare > 0 ? { $literal: tillNoonFare } : snapshotExpr;
  // Cash the rider physically collects — COD only (online payments excluded).
  const codAmountExpr = {
    $cond: [
      { $in: [{ $ifNull: ["$paymentType", "$paymentMethod"] }, COD_TYPES] },
      { $convert: { input: "$orderTotal", to: "double", onError: 0, onNull: 0 } },
      0,
    ],
  };
  const group = {
    _id: null,
    count: { $sum: 1 },
    earnings: { $sum: fareExpr },
    orderAmount: { $sum: codAmountExpr },
  };

  const [agg] = await ordersCol()
    .aggregate([
      { $match: { riderId, status: DELIVERED_STATUS } },
      {
        $facet: {
          total: [{ $group: group }],
          today: [{ $match: { createdAt: { $gte: dayStart } } }, { $group: group }],
          week: [{ $match: { createdAt: { $gte: weekStart } } }, { $group: group }],
          month: [{ $match: { createdAt: { $gte: monthStart } } }, { $group: group }],
        },
      },
    ])
    .toArray();

  const pick = (arr: any[]) => ({
    earnings: Math.round(arr?.[0]?.earnings || 0),
    count: arr?.[0]?.count || 0,
    orderAmount: Math.round(arr?.[0]?.orderAmount || 0),
  });
  const total = pick(agg?.total);
  const today = pick(agg?.today);
  const week = pick(agg?.week);
  const month = pick(agg?.month);

  return {
    totalEarnings: total.earnings,
    totalDeliveries: total.count,
    totalOrderAmount: total.orderAmount,
    todayEarnings: today.earnings,
    todayDeliveries: today.count,
    todayOrderAmount: today.orderAmount,
    weekEarnings: week.earnings,
    weekDeliveries: week.count,
    weekOrderAmount: week.orderAmount,
    monthEarnings: month.earnings,
    monthDeliveries: month.count,
    monthOrderAmount: month.orderAmount,
  };
}

async function saveSession(req: any) {
  await new Promise<void>((ok, fail) =>
    req.session.save((e: any) => (e ? fail(e) : ok()))
  );
}

// Register — creates a rider in the shared users collection
router.post("/rider/register", async (req: any, res: any) => {
  try {
    const { name, phone, password, city, vehicleType } = req.body;
    if (!name || !phone || !password || !city || !vehicleType)
      return res.status(400).json({ message: "All fields are required" });
    const col = usersCol();
    const phoneNorm = normPhone(phone);
    const existing = await col.findOne({ type: "rider", phone: phoneNorm });
    if (existing && !isDeleted(existing))
      return res.status(409).json({ message: "Phone number already registered" });
    const now = new Date();
    const rider = {
      type: "rider",
      name: String(name).trim(),
      phone: phoneNorm,
      password: await bcrypt.hash(String(password), 12),
      city,
      vehicleType,
      isOnline: false,
      status: "idle",
      deleted: false,
      verified: false,
      orderCount: 0,
      riderZones: [],
      pendingCollection: 0,
      unpaidCollection: 0,
      tillNoonFare: 0,
      wallet: { amount: 0, isUsable: true },
      createdAt: now,
      updatedAt: now,
    };
    const result = await col.insertOne(rider as any);
    (req.session as any).riderId = String(result.insertedId);
    await saveSession(req);
    res.status(201).json({
      ...safeRider({ ...rider, _id: result.insertedId }),
      token: signToken(String(result.insertedId)),
    });
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Login
router.post("/rider/login", async (req: any, res: any) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password)
      return res.status(400).json({ message: "Phone and password are required" });
    const phoneNorm = normPhone(phone);
    const rider = await usersCol().findOne({ type: "rider", phone: phoneNorm });
    if (!rider || isDeleted(rider) || !(await checkPassword(String(password), rider.password)))
      return res.status(401).json({ message: "Invalid phone number or password" });
    (req.session as any).riderId = String(rider._id);
    await saveSession(req);
    res.json({ ...safeRider(rider), token: signToken(String(rider._id)) });
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Logout
router.post("/rider/logout", (req: any, res: any) => {
  (req.session as any).riderId = undefined;
  req.session.save(() => res.json({ ok: true }));
});

// Get current rider
router.get("/rider/me", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const rider = await findRiderById(riderId);
    if (!rider || isDeleted(rider)) {
      (req.session as any).riderId = undefined;
      return res.status(401).json({ message: "Rider not found" });
    }
    const earn = await computeEarnings(riderId, Number(rider.tillNoonFare) || 0);
    res.json({
      ...safeRider(rider),
      totalEarnings: earn.totalEarnings,
      totalDeliveries: earn.totalDeliveries || Number(rider.orderCount) || 0,
    });
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Toggle availability
router.put("/rider/availability", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const { isOnline } = req.body;
    const rider = await findRiderById(riderId);
    if (!rider) return res.status(404).json({ message: "Rider not found" });
    await usersCol().updateOne(
      { _id: rider._id },
      { $set: { isOnline: !!isOnline, updatedAt: new Date() } }
    );
    res.json({ ok: true, isOnline: !!isOnline });
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Available orders — unassigned admin-accepted orders, filtered to the rider's city & zones.
// Faithful to the original: a rider only sees orders in their city whose zone is in
// their assigned riderZones. (Zone filter applies only when the rider has zones set.)
router.get("/rider/orders/available", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const rider = await findRiderById(riderId);
    if (!rider) return res.status(404).json({ message: "Rider not found" });

    const query: Record<string, any> = {
      status: AVAILABLE_STATUS,
      selfDelivery: { $ne: true },
      $or: [{ riderId: { $exists: false } }, { riderId: null }, { riderId: "" }],
    };
    if (rider.city) query.city = rider.city;
    const zones = Array.isArray(rider.riderZones) ? rider.riderZones.filter(Boolean) : [];
    if (zones.length) query.zone = { $in: zones };

    const docs = await ordersCol()
      .find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    const tnf = Number(rider.tillNoonFare) || 0;
    res.json(docs.map((d: any) => normalizeOrder(d, tnf)));
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Active orders — assigned to this rider, not yet delivered
router.get("/rider/orders/active", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const rider = await findRiderById(riderId);
    const tnf = Number(rider?.tillNoonFare) || 0;
    const docs = await ordersCol()
      .find({ riderId, status: { $in: ACTIVE_STATUSES } })
      .sort({ updatedAt: -1 })
      .toArray();
    // Fare shown = the rider's current tillNoonFare (overrides the stored snapshot).
    res.json(docs.map((d: any) => normalizeOrder(d, tnf)));
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Order history — delivered orders for this rider, optionally filtered by period.
router.get("/rider/orders/history", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const period = String(req.query.period || "all");
    // Filter by createdAt in the DB query (not updatedAt — it is bulk-written and
    // identical across orders) so the row limit never drops in-period orders.
    const query: any = { riderId, status: DELIVERED_STATUS };
    if (period === "today" || period === "week" || period === "month") {
      query.createdAt = {
        $gte: pktPeriodStart(period === "today" ? "day" : period),
      };
    }
    const rider = await findRiderById(riderId);
    const tnf = Number(rider?.tillNoonFare) || 0;
    const docs = await ordersCol()
      .find(query)
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    // Fare shown = the rider's current tillNoonFare (overrides the stored snapshot).
    res.json(docs.map((d: any) => normalizeOrder(d, tnf)));
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Accept order
router.post("/rider/orders/:orderId/accept", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const rider = await findRiderById(riderId);
    if (!rider) return res.status(404).json({ message: "Rider not found" });
    const activeCount = await ordersCol().countDocuments({
      riderId,
      status: { $in: ACTIVE_STATUSES },
    });
    if (activeCount > 0)
      return res.status(400).json({ message: "Complete your current delivery first." });
    let orderObjectId: ObjectId;
    try {
      orderObjectId = new ObjectId(req.params.orderId);
    } catch {
      return res.status(400).json({ message: "Invalid order id" });
    }
    const now = new Date();
    const updated = await ordersCol().findOneAndUpdate(
      {
        _id: orderObjectId,
        status: AVAILABLE_STATUS,
        $or: [{ riderId: { $exists: false } }, { riderId: null }, { riderId: "" }],
      },
      {
        $set: {
          riderId,
          riderName: rider.name,
          riderPhone: rider.phone,
          riderFare: rider.tillNoonFare ? Number(rider.tillNoonFare) : undefined,
          status: "Rider Accepted",
          acceptedTime: now,
          updatedAt: now,
        },
      },
      { returnDocument: "after" }
    );
    if (!updated) return res.status(409).json({ message: "Order already taken or unavailable." });
    res.json(normalizeOrder(updated, Number(rider.tillNoonFare) || 0));
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Mark arrived at restaurant — additive checkpoint, canonical status stays "Rider Accepted"
router.post("/rider/orders/:orderId/arrived", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const rider = await findRiderById(riderId);
    const tnf = Number(rider?.tillNoonFare) || 0;
    let orderObjectId: ObjectId;
    try {
      orderObjectId = new ObjectId(req.params.orderId);
    } catch {
      return res.status(400).json({ message: "Invalid order id" });
    }
    const updated = await ordersCol().findOneAndUpdate(
      { _id: orderObjectId, riderId, status: "Rider Accepted" },
      { $set: { riderArrived: true, riderArrivedTime: new Date(), updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!updated)
      return res
        .status(409)
        .json({ message: "Order not assigned to you, or not in the accepted state." });
    res.json(normalizeOrder(updated, tnf));
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Update order status
router.put("/rider/orders/:orderId/status", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const { status } = req.body;
    if (!["Rider Picked Up", DELIVERED_STATUS].includes(status))
      return res.status(400).json({ message: "Invalid status" });
    const rider = await findRiderById(riderId);
    const tnf = Number(rider?.tillNoonFare) || 0;
    let orderObjectId: ObjectId;
    try {
      orderObjectId = new ObjectId(req.params.orderId);
    } catch {
      return res.status(400).json({ message: "Invalid order id" });
    }
    // Enforce the 3-step progression server-side: a rider must mark "Arrived at
    // Restaurant" (riderArrived) before picking up. This guards against stale
    // clients or direct API calls skipping the checkpoint.
    const now = new Date();
    const filter: Record<string, any> =
      status === "Rider Picked Up"
        ? { _id: orderObjectId, riderId, status: "Rider Accepted", riderArrived: true }
        : { _id: orderObjectId, riderId, status: "Rider Picked Up" };
    // Additive timestamps that mirror the original app (no shared counter writes).
    const extra: Record<string, any> =
      status === "Rider Picked Up"
        ? { pickUpTime: now }
        : { timeWhenDelivered: now, paidToRider: false };
    const updated = await ordersCol().findOneAndUpdate(
      filter,
      { $set: { status, updatedAt: now, ...extra } },
      { returnDocument: "after" }
    );
    if (!updated) {
      const message =
        status === "Rider Picked Up"
          ? "Mark 'Arrived at Restaurant' first, or order not assigned to you."
          : "Invalid status transition, or order not assigned to you.";
      return res.status(409).json({ message });
    }
    res.json(normalizeOrder(updated, tnf));
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Earnings summary — aggregated from this rider's delivered orders
router.get("/rider/earnings", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const rider = await findRiderById(riderId);
    if (!rider) return res.status(404).json({ message: "Rider not found" });

    const earn = await computeEarnings(riderId, Number(rider.tillNoonFare) || 0);
    const { rating, ratingCount } = riderRating(rider);

    res.json({
      ...earn,
      rating,
      ratingCount,
      pendingCollection: Number(rider.pendingCollection) || 0,
      unpaidCollection: Number(rider.unpaidCollection) || 0,
    });
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// ── GPS location tracking ──────────────────────────────────────────────────────
// In-memory only (no DB). The customer's order-tracking page reads the public
// endpoint below; locations expire after 60 seconds.
const riderLocations = new Map<
  string,
  { lat: number; lng: number; riderId: string; ts: number }
>();
const LOCATION_TTL_MS = 60_000;

// Rider pushes GPS coordinates for an active order they own and are delivering.
router.post("/rider/location", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const { orderId, lat, lng } = req.body || {};
    if (!orderId || typeof lat !== "number" || typeof lng !== "number")
      return res.status(400).json({ message: "orderId, lat and lng are required" });
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180)
      return res.status(400).json({ message: "lat/lng out of range" });
    let orderObjectId: ObjectId;
    try {
      orderObjectId = new ObjectId(String(orderId));
    } catch {
      return res.status(400).json({ message: "Invalid order id" });
    }
    // Only the assigned rider may publish a location, and only while the order
    // is in transit ("Rider Picked Up"). Prevents spoofing other orders.
    const order = await ordersCol().findOne({
      _id: orderObjectId,
      riderId,
      status: "Rider Picked Up",
    });
    if (!order)
      return res
        .status(403)
        .json({ message: "Order is not assigned to you or not in transit" });
    riderLocations.set(String(orderId), { lat, lng, riderId, ts: Date.now() });
    res.json({ ok: true });
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Public — customer's tracking page reads the rider's current location
router.get("/orders/:orderId/rider-location", (req: any, res: any) => {
  const loc = riderLocations.get(String(req.params.orderId));
  if (!loc || Date.now() - loc.ts > LOCATION_TTL_MS)
    return res.status(404).json({ message: "No recent location" });
  res.json({ lat: loc.lat, lng: loc.lng, ts: loc.ts });
});

function toNum(v: any): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function toNumOrNull(v: any): number | null {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function fmtTime(v: any): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString();
}

// Parse a deal item name like "Burger Deal (Coleslaw, Drink)" handled on the client.
function normalizeOrder(doc: any, riderFareOverride?: number) {
  const items = Array.isArray(doc.products)
    ? doc.products.map((p: any) => ({
        name: p.productName || p.name || "Item",
        // The ordered count lives in `count`; for single/non-deal products the
        // `quantity` field instead holds the size/variation descriptor
        // (e.g. "Half", "Regular", "12 Pcs"), so it must not be used as the count.
        quantity: Number(p.count) || 1,
        price: toNum(p.price ?? p.net),
        size:
          p.size ||
          p.variation ||
          (p.type !== "deal" &&
          typeof p.quantity === "string" &&
          p.quantity.trim()
            ? p.quantity.trim()
            : null) ||
          null,
        type: p.type || null,
        // For deal products, the included choices live in selectedFlavours.
        dealItems: Array.isArray(p.selectedFlavours)
          ? p.selectedFlavours.map((f: any) => ({
              title: f.title || null,
              option: f.option || null,
              price: toNum(f.flavourPrice),
            }))
          : [],
      }))
    : [];
  const total = toNum(doc.orderTotal);
  // The rider's pay shown for an order is their CURRENT tillNoonFare (passed in as
  // riderFareOverride from the rider's users-collection doc). It takes precedence
  // over the per-order snapshot; the stored snapshot (riderFare) is only a fallback
  // for riders with no tillNoonFare. Never use deliveryCharges (customer charge).
  const snapshot = toNum(doc.riderFare);
  const override =
    typeof riderFareOverride === "number" && riderFareOverride > 0
      ? riderFareOverride
      : 0;
  const riderFare = override > 0 ? override : snapshot;
  return {
    id: String(doc._id),
    restaurantName: doc.martName || null,
    address: doc.address || null,
    latitude: toNumOrNull(doc.latitude),
    longitude: toNumOrNull(doc.longitude),
    martLatitude: toNumOrNull(doc.martLatitude),
    martLongitude: toNumOrNull(doc.martLongitude),
    phone: doc.phone || null,
    status: doc.status,
    total,
    // Customer-facing delivery charge on the bill — NOT the rider's pay (riderFare).
    deliveryFee: toNum(doc.deliveryCharges),
    riderFare,
    subtotal: Math.max(total - toNum(doc.deliveryCharges), 0) || total,
    items,
    userName: doc.name || null,
    city: doc.city || null,
    zone: doc.zone || null,
    distance: doc.distance != null && doc.distance !== "" ? String(doc.distance) : null,
    martAddress: doc.martAddress || null,
    martPhone: doc.martPhone || null,
    paymentType: doc.paymentType || doc.paymentMethod || null,
    orderNum: doc.orderNum != null ? String(doc.orderNum) : null,
    comment: doc.comment || null,
    tip: toNum(doc.tip),
    discount: toNum(doc.discount),
    platformFee: toNum(doc.platformFee),
    vatAmount: toNum(doc.vatAmount),
    paidToRider: !!doc.paidToRider,
    actions: Array.isArray(doc.actions)
      ? doc.actions.map((a: any) => ({
          action: a.action || a.name || "",
          time: a.time || "",
          name: a.name || "",
        }))
      : [],
    acceptedTime: fmtTime(doc.acceptedTime),
    pickUpTime: fmtTime(doc.pickUpTime),
    timeWhenDelivered: fmtTime(doc.timeWhenDelivered),
    createdAt: fmtTime(doc.createdAt) || String(doc.createdAt),
    updatedAt: fmtTime(doc.updatedAt),
    riderId: doc.riderId || null,
    riderName: doc.riderName || null,
    riderArrived: !!doc.riderArrived,
  };
}

export default router;
