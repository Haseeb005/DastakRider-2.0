---
name: Dastak rider fare source
description: How a rider's per-order fare and earnings are computed, and why deliveryCharges must never be used as pay.
---

# Rider fare = rider's CURRENT tillNoonFare (overrides the snapshot)

`tillNoonFare` is an admin-set per-delivery fare (Rs) stored on each rider USER doc
(`users`, `type:"rider"`), NOT on orders. ~500/507 riders have it (e.g. 60/70/140).
The accept endpoint still snapshots `rider.tillNoonFare` onto the order as `riderFare`.

**Rule (CURRENT, what the user wants):** the fare shown to a rider for ANY order =
their current `tillNoonFare` from the users doc. It OVERRIDES the per-order snapshot
everywhere (available, active, history, accept, arrived, status). The stored
`order.riderFare` snapshot is only a fallback for riders with no `tillNoonFare`.
Earnings = delivered count × current `tillNoonFare` (e.g. tnf 140 × 11623 =
1,627,220). Changing a rider's rate therefore RE-VALUES their whole history/earnings.

**Why:** this is an explicit user decision (chosen over snapshot-based payouts). The
trade-off, if revisited: snapshot = stable payout history when admins change a rate;
current `tillNoonFare` = always-current rate that re-values past deliveries. The
chosen policy is always-current-rate.

**Never use `deliveryCharges` as rider pay** — it is the CUSTOMER's delivery charge.
The normalized `deliveryFee` field = `doc.deliveryCharges` (customer bill line, e.g.
140), which is DISTINCT from `riderFare` (rider payout, e.g. 120). UI "Delivery Fee"
shows `deliveryFee`; rider earnings ("Your Fare"/"Your Earning") must ONLY come from
`riderFare` — never fall back to `deliveryFee`. The order-detail bill is
Subtotal + Delivery Fee + Platform Fee = Total (subtotal = total − deliveryCharges).

**How to apply:** in `artifacts/api-server/src/routes/rider.ts`,
`normalizeOrder(doc, riderFareOverride?)` returns `riderFare = override>0 ? override
: snapshot`. EVERY rider-facing endpoint (available, active, history, accept,
arrived, status) fetches the rider and passes `Number(rider.tillNoonFare)||0` as the
override. `computeEarnings(riderId, tillNoonFare)` sums `{$literal: tillNoonFare}`
per delivered order when tnf>0, else `$ifNull:["$riderFare",0]`.

# Timezone

All order dates/times must display in GMT+5 / `Asia/Karachi` (PKT, no DST). Web
`formatDateTime` forces `timeZone:"Asia/Karachi"`. Backend sends `createdAt` as ISO
(UTC); other time fields (`acceptedTime`/`pickUpTime`/`timeWhenDelivered`) are
already PKT time-only strings passed through as-is. Mobile renders no UTC dates
(only pre-formatted PKT `actions[].time` strings), so no mobile date conversion.
