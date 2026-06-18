---
name: Dastak rider fare source
description: How a rider's per-order fare and earnings are computed, and why deliveryCharges must never be used as pay.
---

# Rider fare = the rider's `tillNoonFare`

`tillNoonFare` is an admin-set per-delivery fare (Rs) stored on each rider USER doc
(`users`, `type:"rider"`), NOT on orders. ~500/507 riders have it (e.g. 60/70/140).
The accept endpoint snapshots `rider.tillNoonFare` onto the order as `riderFare`.

**Rule:** a rider's fare for ANY order = their current `tillNoonFare`. Earnings =
delivered count × `tillNoonFare`. Fall back to the order's stored `riderFare`
snapshot only when the rider has no `tillNoonFare`, then to 0.

**Why:** the user explicitly asked to "always get order fare from tillNoonFare".
`tillNoonFare` is the canonical per-delivery rate; the stored `riderFare` snapshots
are historically unreliable (some were derived from the customer charge).

**Never use `deliveryCharges` as rider pay** — it is the CUSTOMER's delivery charge,
not the rider's fare. It was removed from all fare fallbacks (normalizeOrder +
computeEarnings).

**How to apply:** in `artifacts/api-server/src/routes/rider.ts`, all rider-facing
endpoints fetch the rider and pass `Number(rider.tillNoonFare)||0` into
`normalizeOrder(doc, override)`; `computeEarnings(riderId, tillNoonFare)` sums
`{$literal: tillNoonFare}` per delivered order when it's >0.

**Tradeoff (flagged to user):** because earnings use the CURRENT `tillNoonFare`,
changing a rider's rate retroactively re-values their entire history. If payout
correctness ever matters, switch history/earnings to the stored `riderFare`
snapshot and keep the current-rate override only for pre-accept "available" orders.

# Timezone

All order dates/times must display in GMT+5 / `Asia/Karachi` (PKT, no DST). Web
`formatDateTime` forces `timeZone:"Asia/Karachi"`. Backend sends `createdAt` as ISO
(UTC); other time fields (`acceptedTime`/`pickUpTime`/`timeWhenDelivered`) are
already PKT time-only strings passed through as-is. Mobile renders no UTC dates
(only pre-formatted PKT `actions[].time` strings), so no mobile date conversion.
