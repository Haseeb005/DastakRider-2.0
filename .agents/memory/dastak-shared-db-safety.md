---
name: Dastak shared-DB write safety + GPS authz
description: Rules for writing to the shared Dastak prod Mongo from the rider app, and the GPS location endpoint authz lesson.
---

The rider app shares its Mongo with the live customer + admin apps, so every write to `orders`/`users` is a write those apps also read.

**Additive-only discipline on shared docs.** Only add NEW fields the other apps ignore; never repurpose a canonical field or invent a new `status` string.
- Status transitions stay on the real enum (`Pending → Rider Accepted → Rider Picked Up → Delivered`).
- Checkpoints/timestamps added by the rider app are additive booleans/dates: `riderArrived`/`riderArrivedTime`, `pickUpTime`, `timeWhenDelivered`, `paidToRider:false`, `isOnline`.
- Do NOT increment shared counters (e.g. `orderCount`) on status change — the admin/customer side owns those; a double-write would corrupt their numbers.
**Why:** the apps are coupled through one DB; a non-additive write silently breaks the other two products.
**How to apply:** before writing any field to `orders` or `users` from the rider backend, confirm it is a rider-app-only field or an existing field the rider legitimately owns (`riderId`/`riderName`/`riderFare` on accept).

**GPS location endpoint must authorize ownership + in-transit before accepting a push.** `POST /rider/location` takes an `orderId`; without a check, any authenticated rider can spoof any order's location (the public `GET /orders/:orderId/rider-location` would then serve it). Require the order to be assigned to `req.session.riderId` AND `status:"Rider Picked Up"`, else 403. Also bounds-check lat/lng.
**Why:** broken-access-control flaw flagged in code review — public read endpoint amplifies the spoof.
**How to apply:** any "publish my live location for X" endpoint needs an ownership+state guard, not just auth.

**PKT period math:** Pakistan is UTC+5 with no DST, so period boundaries (today/week/month) are computed as fixed UTC instants by shifting +5h; week starts Sunday (`getUTCDay()`). Safe to hardcode the offset.

**GPS tracking hook lives app-wide, not in a tab.** `useLocationTracking(activeOrders)` is called in the top-level `RiderApp`, so location keeps publishing while an order is `Rider Picked Up` regardless of which tab is open (tab-scoped placement stops tracking on navigation → public location goes stale after the 60s TTL).
