import { Router } from "express";
import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { usersCol, ordersCol } from "../lib/mongo";

const router = Router();

// Real order status flow in the Dastak database:
//   Pending -> Rider Accepted -> Rider Picked Up -> Delivered  (or Rejected)
const ACTIVE_STATUSES = ["Rider Accepted", "Rider Picked Up"];
const AVAILABLE_STATUS = "Pending";
const DELIVERED_STATUS = "Delivered";

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
  return (req.session as any)?.riderId || "";
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

function safeRider(user: any) {
  return {
    id: String(user._id),
    name: user.name || null,
    phone: user.phone || null,
    city: user.city || null,
    vehicleType: user.vehicleType || "bike",
    isOnline: !!user.isOnline,
    totalEarnings: 0,
    totalDeliveries: Number(user.orderCount) || 0,
    rating: 0,
    ratingCount: 0,
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
      wallet: { amount: 0, isUsable: true },
      createdAt: now,
      updatedAt: now,
    };
    const result = await col.insertOne(rider as any);
    (req.session as any).riderId = String(result.insertedId);
    await saveSession(req);
    res.status(201).json(safeRider({ ...rider, _id: result.insertedId }));
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
    res.json(safeRider(rider));
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
    res.json(safeRider(rider));
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

// Available orders — unassigned pending orders
router.get("/rider/orders/available", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const docs = await ordersCol()
      .find({
        status: AVAILABLE_STATUS,
        selfDelivery: { $ne: true },
        $or: [{ riderId: { $exists: false } }, { riderId: null }, { riderId: "" }],
      })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    res.json(docs.map(normalizeOrder));
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
    const docs = await ordersCol()
      .find({ riderId, status: { $in: ACTIVE_STATUSES } })
      .sort({ updatedAt: -1 })
      .toArray();
    res.json(docs.map(normalizeOrder));
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Order history — delivered orders for this rider
router.get("/rider/orders/history", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const docs = await ordersCol()
      .find({ riderId, status: DELIVERED_STATUS })
      .sort({ updatedAt: -1 })
      .limit(100)
      .toArray();
    res.json(docs.map(normalizeOrder));
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
          status: "Rider Accepted",
          acceptedTime: now,
          updatedAt: now,
        },
      },
      { returnDocument: "after" }
    );
    if (!updated) return res.status(409).json({ message: "Order already taken or unavailable." });
    res.json(normalizeOrder(updated));
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
    let orderObjectId: ObjectId;
    try {
      orderObjectId = new ObjectId(req.params.orderId);
    } catch {
      return res.status(400).json({ message: "Invalid order id" });
    }
    const requiredPrev = status === "Rider Picked Up" ? "Rider Accepted" : "Rider Picked Up";
    const updated = await ordersCol().findOneAndUpdate(
      { _id: orderObjectId, riderId, status: requiredPrev },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!updated)
      return res
        .status(409)
        .json({ message: "Invalid status transition, or order not assigned to you." });
    res.json(normalizeOrder(updated));
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const fareExpr = {
      $convert: {
        input: { $ifNull: ["$riderFare", "$deliveryCharges"] },
        to: "double",
        onError: 0,
        onNull: 0,
      },
    };
    const group = { _id: null, count: { $sum: 1 }, earnings: { $sum: fareExpr } };

    const [agg] = await ordersCol()
      .aggregate([
        { $match: { riderId, status: DELIVERED_STATUS } },
        {
          $facet: {
            total: [{ $group: group }],
            today: [{ $match: { updatedAt: { $gte: today } } }, { $group: group }],
            week: [{ $match: { updatedAt: { $gte: weekStart } } }, { $group: group }],
          },
        },
      ])
      .toArray();

    const pick = (arr: any[]) => ({
      earnings: Math.round(arr?.[0]?.earnings || 0),
      count: arr?.[0]?.count || 0,
    });
    const total = pick(agg?.total);
    const todayStats = pick(agg?.today);
    const week = pick(agg?.week);

    res.json({
      totalEarnings: total.earnings,
      totalDeliveries: total.count,
      todayEarnings: todayStats.earnings,
      todayDeliveries: todayStats.count,
      weekEarnings: week.earnings,
      weekDeliveries: week.count,
      rating: 0,
      ratingCount: 0,
    });
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

function toNum(v: any): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function normalizeOrder(doc: any) {
  const items = Array.isArray(doc.products)
    ? doc.products.map((p: any) => ({
        name: p.productName || p.name || "Item",
        quantity: Number(p.count) || 1,
        price: toNum(p.price ?? p.net),
      }))
    : [];
  const total = toNum(doc.orderTotal);
  const deliveryFee = toNum(doc.riderFare ?? doc.deliveryCharges);
  return {
    id: String(doc._id),
    restaurantName: doc.martName || null,
    address: doc.address || null,
    phone: doc.phone || null,
    status: doc.status,
    total,
    deliveryFee,
    subtotal: Math.max(total - toNum(doc.deliveryCharges), 0) || total,
    items,
    userName: doc.name || null,
    createdAt:
      doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
    updatedAt:
      doc.updatedAt instanceof Date
        ? doc.updatedAt.toISOString()
        : doc.updatedAt
          ? String(doc.updatedAt)
          : null,
    riderId: doc.riderId || null,
    riderName: doc.riderName || null,
  };
}

export default router;
