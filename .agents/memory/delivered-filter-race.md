---
name: Delivered filter race condition
description: The external admin system reverts status writes within seconds; the "Delivered" update must not filter on status === "Rider Picked Up".
---

## Rule

The `PUT /rider/orders/:id/status` route for `status === "Delivered"` must filter on additive timestamps we own — not on the `status` field which the admin system can revert at any moment.

**Use this filter:**
```js
{ _id: orderObjectId, riderId, pickUpTime: { $exists: true }, timeWhenDelivered: { $exists: false } }
```

- `pickUpTime` present → rider physically picked up (set by our "Rider Picked Up" PUT, admin never clears it)
- `timeWhenDelivered` absent → not yet delivered (prevents double-delivery on retry)

**Why:** Observed July 2026 — first PUT ("Rider Picked Up") returned 200, admin system reverted within ~5 s, second PUT ("Delivered") returned 409 because `{ status: "Rider Picked Up" }` no longer matched.

**How to apply:** Any future status that needs to be sequenced after an admin-visible status change should use rider-owned additive timestamps as the filter key instead of the current status value.
