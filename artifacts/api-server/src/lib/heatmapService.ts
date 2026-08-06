/**
 * heatmapService
 *
 * Computes a live demand-score grid for every city every 2 minutes.
 * Results are held in-memory so the REST endpoint can respond in <20 ms.
 *
 * Scoring formula (all inputs normalised per zone before weighting):
 *   +40%  Waiting orders  (Admin Accepted, no riderId, within zone)
 *   +25%  New orders      (created in last 15 min, within zone)
 *   +15%  Historical avg  (same weekday + hour, last 4 weeks, within zone)
 *   +10%  Restaurant density (unique mart coords within zone)
 *   −10%  Available riders  (online idle riders in same city — city-level penalty)
 *
 * Zone grid: 0.0045° lat × 0.0053° lng ≈ 500 m × 500 m at ~32° N.
 */

import { logger } from "./logger";
import { ordersCol, usersCol } from "./mongo";

// ─── Constants ───────────────────────────────────────────────────────────────

const RECALC_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const CELL_LAT = 0.0045; // ~500 m
const CELL_LNG = 0.0053; // ~500 m
const NEW_ORDER_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const HISTORY_WEEKS = 4;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HeatmapZone {
  zoneId: string;       // "lat_lng" grid key
  lat: number;          // zone centre latitude
  lng: number;          // zone centre longitude
  score: number;        // 0-100
  color: string;        // hex colour
  label: string;        // "Low" | "Moderate" | "Busy" | "Very Busy" | "Hotspot"
  waitingOrders: number;
  newOrders: number;
  historicalAvg: number;
  restaurantCount: number;
  city: string;
}

export interface RestaurantHotspot {
  name: string;
  lat: number;
  lng: number;
  city: string;
  weeklyOrders: number;   // orders in last 7 days
  waitingOrders: number;  // currently waiting for a rider
  recentOrders: number;   // created in last 15 min
  score: number;          // 0-100 demand score
  color: string;          // hex colour matching score
  label: string;
}

export interface HeatmapSnapshot {
  zones: HeatmapZone[];
  restaurants: RestaurantHotspot[];
  updatedAt: string;    // ISO timestamp
  cities: string[];
}

// ─── In-memory cache ─────────────────────────────────────────────────────────

let cachedSnapshot: HeatmapSnapshot = {
  zones: [],
  restaurants: [],
  updatedAt: new Date().toISOString(),
  cities: [],
};

export function getHeatmapSnapshot(city?: string): HeatmapSnapshot {
  if (!city) return cachedSnapshot;
  return {
    ...cachedSnapshot,
    zones: cachedSnapshot.zones.filter((z) => z.city === city),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cellKey(lat: number, lng: number): string {
  const row = Math.floor(lat / CELL_LAT);
  const col = Math.floor(lng / CELL_LNG);
  return `${row}_${col}`;
}

function cellCenter(key: string): { lat: number; lng: number } {
  const [row, col] = key.split("_").map(Number);
  return {
    lat: (row + 0.5) * CELL_LAT,
    lng: (col + 0.5) * CELL_LNG,
  };
}

function scoreToColor(score: number): { color: string; label: string } {
  if (score <= 20) return { color: "#22c55e", label: "Low" };
  if (score <= 40) return { color: "#84cc16", label: "Moderate" };
  if (score <= 60) return { color: "#eab308", label: "Busy" };
  if (score <= 80) return { color: "#f97316", label: "Very Busy" };
  return { color: "#dc2626", label: "Hotspot" };
}

function safeFloat(v: any): number | null {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

// Normalise a map of counts to 0-100 relative to the max in that map.
function normaliseMap(map: Map<string, number>): Map<string, number> {
  const max = Math.max(...map.values(), 1);
  const out = new Map<string, number>();
  map.forEach((v, k) => out.set(k, (v / max) * 100));
  return out;
}

// ─── Core calculation ────────────────────────────────────────────────────────

async function recalculate(): Promise<void> {
  try {
    const now = new Date();
    const since15 = new Date(now.getTime() - NEW_ORDER_WINDOW_MS);

    // ── 1. Waiting orders (Admin Accepted, no riderId) ────────────────────
    const waitingRaw = await ordersCol()
      .find(
        {
          status: "Admin Accepted",
          $or: [{ riderId: { $exists: false } }, { riderId: "" }],
          latitude: { $exists: true, $nin: [null, ""] },
          longitude: { $exists: true, $nin: [null, ""] },
        },
        { projection: { latitude: 1, longitude: 1, city: 1, _id: 0 } },
      )
      .toArray();

    const waitingByZone = new Map<string, number>();
    const cityByZone = new Map<string, string>();

    for (const doc of waitingRaw) {
      const lat = safeFloat(doc.latitude);
      const lng = safeFloat(doc.longitude);
      if (lat === null || lng === null) continue;
      const key = cellKey(lat, lng);
      waitingByZone.set(key, (waitingByZone.get(key) ?? 0) + 1);
      if (doc.city) cityByZone.set(key, doc.city);
    }

    // ── 2. New orders in last 15 min ──────────────────────────────────────
    const newRaw = await ordersCol()
      .find(
        {
          createdAt: { $gte: since15 },
          latitude: { $exists: true, $nin: [null, ""] },
          longitude: { $exists: true, $nin: [null, ""] },
        },
        { projection: { latitude: 1, longitude: 1, city: 1, _id: 0 } },
      )
      .toArray();

    const newByZone = new Map<string, number>();
    for (const doc of newRaw) {
      const lat = safeFloat(doc.latitude);
      const lng = safeFloat(doc.longitude);
      if (lat === null || lng === null) continue;
      const key = cellKey(lat, lng);
      newByZone.set(key, (newByZone.get(key) ?? 0) + 1);
      if (doc.city) cityByZone.set(key, doc.city);
    }

    // ── 3. Historical demand (same weekday ± 0, same hour ± 1, last N weeks) ─
    const dayOfWeek = now.getDay();
    const hour = now.getHours();
    const historicalDocs: any[] = [];

    for (let w = 1; w <= HISTORY_WEEKS; w++) {
      const weekStart = new Date(now.getTime() - w * 7 * 24 * 60 * 60 * 1000);
      // Use dateForSearching to match the same weekday
      const dayStart = new Date(weekStart);
      dayStart.setDate(dayStart.getDate() - ((dayStart.getDay() - dayOfWeek + 7) % 7));
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const batch = await ordersCol()
        .find(
          {
            createdAt: { $gte: dayStart, $lte: dayEnd },
            latitude: { $exists: true, $nin: [null, ""] },
            longitude: { $exists: true, $nin: [null, ""] },
          },
          { projection: { latitude: 1, longitude: 1, city: 1, createdAt: 1, _id: 0 } },
        )
        .toArray();

      // Filter to same ±1 hour window
      for (const doc of batch) {
        const docHour = new Date(doc.createdAt).getHours();
        if (Math.abs(docHour - hour) <= 1) historicalDocs.push(doc);
      }
    }

    const histByZone = new Map<string, number>();
    for (const doc of historicalDocs) {
      const lat = safeFloat(doc.latitude);
      const lng = safeFloat(doc.longitude);
      if (lat === null || lng === null) continue;
      const key = cellKey(lat, lng);
      // Average across weeks
      histByZone.set(key, (histByZone.get(key) ?? 0) + 1 / HISTORY_WEEKS);
      if (doc.city) cityByZone.set(key, doc.city);
    }

    // ── 4. Restaurant density via mart coordinates ─────────────────────────
    // Use unique martLatitude/martLongitude from recent orders as a proxy
    // for active restaurant locations (more reliable than the restaurants
    // collection which lacks coordinates).
    const martRaw = await ordersCol()
      .find(
        {
          martLatitude: { $exists: true, $nin: [null, ""] },
          martLongitude: { $exists: true, $nin: [null, ""] },
          createdAt: { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
        },
        { projection: { martLatitude: 1, martLongitude: 1, city: 1, _id: 0 } },
      )
      .limit(5000)
      .toArray();

    // Deduplicate mart locations (one point per ~50m)
    const seenMarts = new Set<string>();
    const martByZone = new Map<string, number>();
    for (const doc of martRaw) {
      const lat = safeFloat(doc.martLatitude);
      const lng = safeFloat(doc.martLongitude);
      if (lat === null || lng === null) continue;
      const dedupKey = `${Math.round(lat * 200)}_${Math.round(lng * 200)}`; // ~50 m
      if (seenMarts.has(dedupKey)) continue;
      seenMarts.add(dedupKey);
      const key = cellKey(lat, lng);
      martByZone.set(key, (martByZone.get(key) ?? 0) + 1);
      if (doc.city) cityByZone.set(key, doc.city);
    }

    // ── 5. Online idle riders per city ────────────────────────────────────
    const ridersByCity = new Map<string, number>();
    const riderDocs = await usersCol()
      .find(
        { type: "rider", isOnline: true, status: "idle" },
        { projection: { city: 1, _id: 0 } },
      )
      .toArray();
    for (const r of riderDocs) {
      if (r.city) ridersByCity.set(r.city, (ridersByCity.get(r.city) ?? 0) + 1);
    }
    const maxRiders = Math.max(...ridersByCity.values(), 1);

    // ── Normalise each signal ─────────────────────────────────────────────
    const normWaiting  = normaliseMap(waitingByZone);
    const normNew      = normaliseMap(newByZone);
    const normHist     = normaliseMap(histByZone);
    const normMart     = normaliseMap(martByZone);

    // ── Combine all zone keys ─────────────────────────────────────────────
    const allKeys = new Set([
      ...waitingByZone.keys(),
      ...newByZone.keys(),
      ...histByZone.keys(),
      ...martByZone.keys(),
    ]);

    // Only emit zones that have at least some signal (skip empty desert cells)
    const MIN_SIGNAL = 5; // normalised score threshold

    const zones: HeatmapZone[] = [];
    for (const key of allKeys) {
      const w  = normWaiting.get(key)  ?? 0;
      const n  = normNew.get(key)      ?? 0;
      const h  = normHist.get(key)     ?? 0;
      const m  = normMart.get(key)     ?? 0;
      const city = cityByZone.get(key) ?? "";

      // City-level rider penalty (normalised 0-100, then inverted)
      const ridersInCity  = ridersByCity.get(city) ?? 0;
      const riderPenalty  = (ridersInCity / maxRiders) * 100;

      const rawScore =
        w * 0.40 +
        n * 0.25 +
        h * 0.15 +
        m * 0.10 -
        riderPenalty * 0.10;

      const score = Math.round(Math.max(0, Math.min(100, rawScore)));

      if (score < MIN_SIGNAL && waitingByZone.get(key) === undefined) continue;

      const center = cellCenter(key);
      const { color, label } = scoreToColor(score);

      zones.push({
        zoneId: key,
        lat: Math.round(center.lat * 1e6) / 1e6,
        lng: Math.round(center.lng * 1e6) / 1e6,
        score,
        color,
        label,
        waitingOrders: waitingByZone.get(key)  ?? 0,
        newOrders:     newByZone.get(key)       ?? 0,
        historicalAvg: Math.round((histByZone.get(key) ?? 0) * 10) / 10,
        restaurantCount: martByZone.get(key)   ?? 0,
        city,
      });
    }

    // Sort hottest first (useful for admin / debugging)
    zones.sort((a, b) => b.score - a.score);

    // ── 6. Restaurant hotspots ────────────────────────────────────────────
    // Aggregate orders by mart (restaurant) to show which outlets are
    // generating the most demand right now and over the last 7 days.
    const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Weekly volume per restaurant
    const weeklyAgg = await ordersCol()
      .aggregate([
        {
          $match: {
            createdAt: { $gte: since7d },
            martName: { $exists: true, $nin: [null, ""] },
            martLatitude: { $exists: true, $nin: [null, ""] },
            martLongitude: { $exists: true, $nin: [null, ""] },
          },
        },
        {
          $group: {
            _id: {
              name: "$martName",
              lat: "$martLatitude",
              lng: "$martLongitude",
              city: "$city",
            },
            weeklyOrders: { $sum: 1 },
          },
        },
        { $sort: { weeklyOrders: -1 } },
        { $limit: 100 },
      ])
      .toArray();

    // Waiting orders per restaurant (Admin Accepted, no riderId)
    const waitingAgg = await ordersCol()
      .aggregate([
        {
          $match: {
            status: "Admin Accepted",
            $or: [{ riderId: { $exists: false } }, { riderId: "" }],
            martName: { $exists: true, $nin: [null, ""] },
          },
        },
        { $group: { _id: "$martName", waitingOrders: { $sum: 1 } } },
      ])
      .toArray();
    const waitingByMart = new Map<string, number>(
      waitingAgg.map((r: any) => [r._id, r.waitingOrders]),
    );

    // New orders in last 15 min per restaurant
    const recentAgg = await ordersCol()
      .aggregate([
        {
          $match: {
            createdAt: { $gte: since15 },
            martName: { $exists: true, $nin: [null, ""] },
          },
        },
        { $group: { _id: "$martName", recentOrders: { $sum: 1 } } },
      ])
      .toArray();
    const recentByMart = new Map<string, number>(
      recentAgg.map((r: any) => [r._id, r.recentOrders]),
    );

    // Build scored restaurant list
    const maxWeekly = Math.max(...weeklyAgg.map((r: any) => r.weeklyOrders), 1);
    const maxWaiting = Math.max(...[...waitingByMart.values()], 1);
    const maxRecent  = Math.max(...[...recentByMart.values()], 1);

    const restaurants: RestaurantHotspot[] = weeklyAgg
      .map((r: any) => {
        const name = r._id.name as string;
        const lat  = safeFloat(r._id.lat);
        const lng  = safeFloat(r._id.lng);
        if (lat === null || lng === null) return null;

        const waiting = waitingByMart.get(name) ?? 0;
        const recent  = recentByMart.get(name)  ?? 0;

        // Score: 50% weekly history, 35% waiting now, 15% last-15-min new
        const rawScore =
          (r.weeklyOrders / maxWeekly) * 50 +
          (waiting / maxWaiting) * 35 +
          (recent / maxRecent) * 15;

        const score = Math.round(Math.min(100, rawScore));
        const { color, label } = scoreToColor(score);

        return {
          name,
          lat,
          lng,
          city: (r._id.city as string) ?? "",
          weeklyOrders: r.weeklyOrders as number,
          waitingOrders: waiting,
          recentOrders: recent,
          score,
          color,
          label,
        } satisfies RestaurantHotspot;
      })
      .filter(Boolean) as RestaurantHotspot[];

    // Sort hottest restaurant first
    restaurants.sort((a, b) => b.score - a.score);

    const cities = [
      ...new Set(
        [...zones.map((z) => z.city), ...restaurants.map((r) => r.city)].filter(Boolean),
      ),
    ];

    cachedSnapshot = {
      zones,
      restaurants,
      updatedAt: now.toISOString(),
      cities,
    };

    logger.info(
      { zoneCount: zones.length, cities },
      "heatmapService: recalculated",
    );
  } catch (err) {
    logger.error({ err }, "heatmapService: recalculation failed");
  }
}

// ─── Public start function ────────────────────────────────────────────────────

export function startHeatmapScheduler(): void {
  // Run immediately on startup, then every 2 minutes.
  recalculate();
  setInterval(recalculate, RECALC_INTERVAL_MS);
  logger.info(
    { intervalMs: RECALC_INTERVAL_MS },
    "heatmapService: scheduler started",
  );
}
