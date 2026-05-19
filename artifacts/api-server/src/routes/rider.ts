import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { ridersCol, ordersCol } from "../lib/mongo";

const router = Router();

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

// Register
router.post("/rider/register", async (req: any, res: any) => {
  try {
    const { name, phone, password, city, vehicleType } = req.body;
    if (!name || !phone || !password || !city || !vehicleType)
      return res.status(400).json({ message: "All fields are required" });
    const col = ridersCol();
    const normPhone = String(phone).replace(/[\s\-()]/g, "");
    if (await col.findOne({ phone: normPhone }))
      return res.status(409).json({ message: "Phone number already registered" });
    const passwordHash = await bcrypt.hash(password, 12);
    const rider = {
      id: randomUUID(),
      name: String(name).trim(),
      phone: normPhone,
      passwordHash,
      city,
      vehicleType,
      isOnline: false,
      isAvailable: true,
      totalEarnings: 0,
      totalDeliveries: 0,
      rating: 0,
      ratingCount: 0,
      createdAt: new Date(),
    };
    await col.insertOne(rider);
    (req.session as any).riderId = rider.id;
    await new Promise<void>((ok, fail) => req.session.save((e: any) => (e ? fail(e) : ok())));
    const { passwordHash: _, ...safe } = rider;
    res.status(201).json(safe);
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
    const normPhone = String(phone).replace(/[\s\-()]/g, "");
    const rider = await ridersCol().findOne({ phone: normPhone });
    if (!rider || !(await bcrypt.compare(password, rider.passwordHash)))
      return res.status(401).json({ message: "Invalid phone number or password" });
    (req.session as any).riderId = rider.id;
    await new Promise<void>((ok, fail) => req.session.save((e: any) => (e ? fail(e) : ok())));
    const { passwordHash: _, ...safe } = rider;
    res.json(safe);
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
    const rider = await ridersCol().findOne({ id: riderId });
    if (!rider) {
      (req.session as any).riderId = undefined;
      return res.status(401).json({ message: "Rider not found" });
    }
    const { passwordHash: _, ...safe } = rider;
    res.json(safe);
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
    await ridersCol().updateOne(
      { id: riderId },
      { $set: { isOnline: !!isOnline, updatedAt: new Date() } }
    );
    res.json({ ok: true, isOnline: !!isOnline });
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Available orders
router.get("/rider/orders/available", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const docs = await ordersCol()
      .find({
        status: { $in: ["placed"] },
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

// Active orders
router.get("/rider/orders/active", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const docs = await ordersCol()
      .find({ riderId, status: { $in: ["confirmed", "preparing", "out_for_delivery"] } })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(docs.map(normalizeOrder));
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Order history
router.get("/rider/orders/history", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const docs = await ordersCol()
      .find({ riderId, status: "delivered" })
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
    const rider = await ridersCol().findOne({ id: riderId });
    if (!rider) return res.status(404).json({ message: "Rider not found" });
    const activeCount = await ordersCol().countDocuments({
      riderId,
      status: { $in: ["confirmed", "preparing", "out_for_delivery"] },
    });
    if (activeCount > 0)
      return res.status(400).json({ message: "Complete your current delivery first." });
    const updated = await ordersCol().findOneAndUpdate(
      {
        id: req.params.orderId,
        status: "placed",
        $or: [{ riderId: { $exists: false } }, { riderId: null }, { riderId: "" }],
      },
      {
        $set: {
          riderId,
          riderName: rider.name,
          riderPhone: rider.phone,
          riderVehicle: rider.vehicleType,
          riderRating: rider.rating,
          status: "confirmed",
          updatedAt: new Date(),
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
    if (!["preparing", "out_for_delivery", "delivered"].includes(status))
      return res.status(400).json({ message: "Invalid status" });
    const updated = await ordersCol().findOneAndUpdate(
      { id: req.params.orderId, riderId },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!updated) return res.status(404).json({ message: "Order not found or not assigned to you." });
    if (status === "delivered") {
      const deliveryFee = parseFloat(String(updated.deliveryFee)) || 50;
      await ridersCol().updateOne(
        { id: riderId },
        {
          $inc: { totalEarnings: deliveryFee, totalDeliveries: 1 },
          $set: { isAvailable: true, updatedAt: new Date() },
        }
      );
    }
    res.json(normalizeOrder(updated));
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Earnings summary
router.get("/rider/earnings", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const rider = await ridersCol().findOne({ id: riderId });
    if (!rider) return res.status(404).json({ message: "Rider not found" });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const [todayOrders, weekOrders] = await Promise.all([
      ordersCol().find({ riderId, status: "delivered", updatedAt: { $gte: today } }).toArray(),
      ordersCol().find({ riderId, status: "delivered", updatedAt: { $gte: weekStart } }).toArray(),
    ]);
    const sum = (arr: any[]) =>
      arr.reduce((s, o) => s + (parseFloat(String(o.deliveryFee)) || 50), 0);
    res.json({
      totalEarnings: rider.totalEarnings || 0,
      totalDeliveries: rider.totalDeliveries || 0,
      todayEarnings: sum(todayOrders),
      todayDeliveries: todayOrders.length,
      weekEarnings: sum(weekOrders),
      weekDeliveries: weekOrders.length,
      rating: rider.rating || 0,
      ratingCount: rider.ratingCount || 0,
    });
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

function normalizeOrder(doc: any) {
  return {
    id: doc.id || String(doc._id),
    restaurantName: doc.restaurantName || null,
    address: doc.address || null,
    phone: doc.phone || null,
    status: doc.status,
    total: parseFloat(String(doc.total || 0)),
    deliveryFee: parseFloat(String(doc.deliveryFee || 50)),
    subtotal: parseFloat(String(doc.subtotal || 0)),
    items: doc.items || [],
    userName: doc.userName || null,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : (doc.updatedAt ? String(doc.updatedAt) : null),
    riderId: doc.riderId || null,
    riderName: doc.riderName || null,
  };
}

export default router;
