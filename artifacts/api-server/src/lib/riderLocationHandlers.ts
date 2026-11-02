import { ObjectId, type Collection, type Document } from "mongodb";

// Matches the customer API's riderLocations reader, not a process-local cache.
export const RIDER_LOCATION_TTL_MS = 5 * 60_000;

export function mongoOrderId(value: unknown): ObjectId | null {
  return typeof value === "string" && /^[a-f\d]{24}$/i.test(value)
    ? new ObjectId(value)
    : null;
}

export function isFreshRiderLocationTime(value: unknown, now = Date.now()): boolean {
  const ts = value instanceof Date
    ? value.getTime()
    : typeof value === "string" || typeof value === "number"
      ? new Date(value).getTime()
      : NaN;
  return Number.isFinite(ts) && ts <= now && now - ts <= RIDER_LOCATION_TTL_MS;
}

export function createRiderLocationHandlers(deps: {
  orders: () => Collection<Document>;
  locations: () => Collection<Document>;
  requireRiderId: (req: any, res: any) => string | null;
}) {
  return {
    async publish(req: any, res: any) {
      res.setHeader("Cache-Control", "private, no-store");
      const riderId = deps.requireRiderId(req, res);
      if (!riderId) return;
      const { orderId, lat, lng } = req.body || {};
      const _id = mongoOrderId(orderId);
      if (!_id) return res.status(400).json({ message: "Invalid MongoDB order id" });
      try {
        // Identity comes exclusively from the verified session/bearer token.
        const order = await deps.orders().findOne(
          { _id, riderId, status: "Rider Picked Up" },
          { projection: { _id: 1 } },
        );
        if (!order) {
          return res.status(403).json({ message: "Order is not assigned to you or not in transit" });
        }
        if (
          typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90 ||
          typeof lng !== "number" || !Number.isFinite(lng) || Math.abs(lng) > 180
        ) {
          return res.status(400).json({ message: "Valid lat and lng are required" });
        }
        const canonicalId = _id.toHexString();
        const update = {
          $set: { orderId: canonicalId, riderId, lat, lng, updatedAt: new Date() },
        };
        // Deterministic _id prevents duplicate inserts when foreground and
        // background writers first publish simultaneously. Existing records
        // with an older _id are updated by orderId for compatibility.
        try {
          await deps.locations().updateOne(
            { orderId: canonicalId },
            { ...update, $setOnInsert: { _id: _id } },
            { upsert: true },
          );
        } catch (error: any) {
          if (error?.code !== 11000) throw error;
          const result = await deps.locations().updateOne({ orderId: canonicalId }, update);
          if (!result.matchedCount) throw error;
        }
        return res.json({ ok: true });
      } catch {
        // Never log request bodies, coordinates or tokens.
        req.log?.error("Failed to persist rider location");
        return res.status(503).json({ message: "Location update could not be saved" });
      }
    },

    async read(req: any, res: any) {
      res.setHeader("Cache-Control", "private, no-store");
      const riderId = deps.requireRiderId(req, res);
      if (!riderId) return;
      const _id = mongoOrderId(req.params.orderId);
      if (!_id) return res.status(400).json({ message: "Invalid MongoDB order id" });
      try {
        // This is the Rider API. Customer ownership/admin authorization remains
        // in the separate trusted-auth customer API, which reads the same data.
        const order = await deps.orders().findOne(
          { _id, riderId },
          { projection: { status: 1 } },
        );
        if (!order) return res.status(404).json({ message: "Order not found" });
        if (order.status !== "Rider Picked Up") return res.json(null);
        const entry = await deps.locations().findOne({
          orderId: _id.toHexString(), riderId,
        });
        if (
          !entry || !isFreshRiderLocationTime(entry.updatedAt) ||
          typeof entry.lat !== "number" || !Number.isFinite(entry.lat) || Math.abs(entry.lat) > 90 ||
          typeof entry.lng !== "number" || !Number.isFinite(entry.lng) || Math.abs(entry.lng) > 180
        ) return res.json(null);
        return res.json({ lat: entry.lat, lng: entry.lng, ts: new Date(entry.updatedAt).getTime() });
      } catch {
        req.log?.error("Failed to read rider location");
        return res.status(503).json({ message: "Location is temporarily unavailable" });
      }
    },
  };
}
