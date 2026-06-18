---
name: Dastak production DB schema (rider app)
description: How riders and orders are really stored in the shared Dastak MongoDB, used by the rider app.
---

The rider app talks to the **real Dastak production MongoDB** (`MONGODB_URI`, db name `test`, 70k+ users, 220k+ orders). There is a `riders` collection but it is **empty** — do not use it.

**Riders** live in the `users` collection with `type: "rider"` (~508 of them).
- Password is field `password`, **mostly plaintext** (~483) with a few bcrypt (~25). Auth must try bcrypt only when the stored value starts with `$2`, else plain string compare.
- Phones stored in Pakistani local format (`03XXXXXXXXX`); normalize input by stripping spaces/dashes/parens before matching.
- `deleted` may be boolean `true` or string `"false"` — treat only `true`/`"true"` as deleted.
- Useful fields: name, phone, city, zone, riderZones, status ("idle"), orderCount, cnic, riderAddress. No `vehicleType`/`isOnline`/`rating` natively — the rider app adds `isOnline` (additive, safe) and defaults vehicleType/rating.

**Orders** (`orders` collection) link to a rider via `riderId` (string of the rider user's ObjectId hex), plus `riderName`, `riderPhone`. Orders have no separate `id` field — use `_id` (ObjectId).
- Status flow: `Pending` → `Rider Accepted` → `Rider Picked Up` → `Delivered` (also `Rejected`, and typo variants `Rejectes`/`Rejjected`). These exact strings matter for queries.
- Rider earning per order is `riderFare` (number), fallback `deliveryCharges` (often a string). Order value is `orderTotal`. Line items are in `products[]` (`productName`, `count`, `price`).
- Mart = restaurant: `martName`, `martPhone`, `martAddress`, `martLatitude/Longitude`; customer = `name`, `phone`, `address`, `latitude/longitude`. `selfDelivery: true` means the mart delivers — exclude from available list.

**Why:** the rider app was originally written against an invented `riders`/`passwordHash` schema and lowercase statuses (`placed`/`confirmed`/`delivered`), so no real rider could log in and no real order matched. Backend (`artifacts/api-server/src/routes/rider.ts`) and frontend status logic must use the real schema above.

**Rider earnings/rating are NOT stored on the user doc — compute from orders.** The `users` (type:rider) docs have no usable `totalEarnings`/`rating` (rating/reviews exist on ~1 rider only; `wallet` on ~333). So derive Profile + Earnings totals by aggregating that rider's `Delivered` orders' `riderFare` (fallback `deliveryCharges`). Both `/rider/me` and `/rider/earnings` must use the same shared aggregation so the Profile header and Earnings tab never disagree. `orderCount` is only a fallback for delivery count. Show rating just as a fallback (`reviews.length`/`ratingCount`) and hide it when 0 — do not fabricate.
