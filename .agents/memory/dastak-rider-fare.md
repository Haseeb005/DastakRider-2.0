---
name: Dastak rider fare source
description: How a rider's per-order fare and earnings are computed, and why deliveryCharges must never be used as pay.
---

# Rider fare = per-order snapshot; current rate only for pre-accept orders

`tillNoonFare` is an admin-set per-delivery fare (Rs) stored on each rider USER doc
(`users`, `type:"rider"`), NOT on orders. ~500/507 riders have it (e.g. 60/70/140).
The accept endpoint snapshots `rider.tillNoonFare` onto the order as `riderFare`,
locking the rate at accept time.

**Rule (payout-correct):** a rider's fare for an order is the per-order snapshot
`order.riderFare`. The rider's CURRENT `tillNoonFare` is used ONLY as a fallback
for pre-accept "available" orders (which have no snapshot yet). Earnings = sum of
stored `riderFare` over delivered orders — NOT count × current rate. So changing a
rider's rate never re-values past deliveries. ~99.6% of delivered orders carry a
snapshot; the ~811 that don't are ancient 2021 orders with zero charge → count as 0.

**Why:** the user first asked to "always get fare from tillNoonFare" (we used the
current rate everywhere), then explicitly switched to: snapshot for history/earnings,
current rate only for new/available orders — to keep historical payouts correct when
admins change a rate.

**Never use `deliveryCharges` as rider pay** — it is the CUSTOMER's delivery charge.
The normalized `deliveryFee` field = `doc.deliveryCharges` (customer bill line, e.g.
140), which is DISTINCT from `riderFare` (rider payout, e.g. 120). UI "Delivery Fee"
shows `deliveryFee`; rider earnings ("Your Fare"/"Your Earning") must ONLY come from
`riderFare` — never fall back to `deliveryFee`. The order-detail bill is
Subtotal + Delivery Fee + Platform Fee = Total (subtotal = total − deliveryCharges).

**How to apply:** in `artifacts/api-server/src/routes/rider.ts`,
`normalizeOrder(doc, currentRateFallback?)` returns `riderFare = snapshot>0 ?
snapshot : fallback`. ONLY the `/available` endpoint passes the fallback
(`Number(rider.tillNoonFare)||0`); active/history/accept/arrived/status pass nothing
(snapshot-only). `computeEarnings(riderId)` sums `$ifNull:["$riderFare",0]`.

# Timezone

All order dates/times must display in GMT+5 / `Asia/Karachi` (PKT, no DST). Web
`formatDateTime` forces `timeZone:"Asia/Karachi"`. Backend sends `createdAt` as ISO
(UTC); other time fields (`acceptedTime`/`pickUpTime`/`timeWhenDelivered`) are
already PKT time-only strings passed through as-is. Mobile renders no UTC dates
(only pre-formatted PKT `actions[].time` strings), so no mobile date conversion.
