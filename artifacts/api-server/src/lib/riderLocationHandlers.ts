import { ObjectId, type Collection, type Document } from "mongodb";

// Matches the customer API's riderLocations reader, not a process-local cache.
export const RIDER_LOCATION_TTL_MS = 5 * 60_000;
export const MAX_LOCATION_AGE_MS = 30_000;
export const MAX_LOCATION_FUTURE_SKEW_MS = 5_000;

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

export function parseCapturedAt(value: unknown, now = Date.now()): Date | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    timestamp > now + MAX_LOCATION_FUTURE_SKEW_MS ||
    now - timestamp > MAX_LOCATION_AGE_MS
  ) return null;
  return new Date(timestamp);
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
      const { orderId, lat, lng, capturedAt } = req.body || {};
      const _id = mongoOrderId(orderId);
      if (!_id) return res.status(400).json({ message: "Invalid MongoDB order id" });
      const capturedAtDate = parseCapturedAt(capturedAt);
      if (!capturedAtDate) return res.status(400).json({ message: "capturedAt must be a fresh ISO timestamp" });
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
        const location = {
          orderId: canonicalId,
          riderId,
          lat,
          lng,
          capturedAt: capturedAtDate,
          updatedAt: capturedAtDate,
        };
        const newestFixFilter = {
          orderId: canonicalId,
          $or: [
            { updatedAt: { $lte: capturedAtDate } },
            { updatedAt: { $exists: false } },
          ],
        };
        try {
          const update = await deps.locations().updateOne(
            newestFixFilter,
            { $set: location },
          );
          if (update.matchedCount) return res.json({ ok: true });

          const existing = await deps.locations().findOne(
            { orderId: canonicalId },
            { projection: { _id: 1 } },
          );
          // A later fix was already saved; acknowledge this older in-flight
          // request without allowing it to move the customer map backwards.
          if (existing) return res.json({ ok: true });

          await deps.locations().insertOne({ _id, ...location });
        } catch (error: any) {
          if (error?.code !== 11000) throw error;
          const update = await deps.locations().updateOne(
            newestFixFilter,
            { $set: location },
          );
          if (!update.matchedCount) {
            const existing = await deps.locations().findOne(
              { orderId: canonicalId },
              { projection: { _id: 1 } },
            );
            if (!existing) throw error;
          }
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
