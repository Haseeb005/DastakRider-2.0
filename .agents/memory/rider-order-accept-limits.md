---
name: Rider accept-order limits
description: How cash-collection and concurrent-order limits work on the rider order-accept endpoint, and what NOT to port from pasted legacy specs.
---

The rider order-accept endpoint enforces the following admin-owned cash collection limit; concurrent-order eligibility is now based on live order statuses:

- `paymentLimit` / `pendingCollection`: only COD orders count against this cash-in-hand limit. Online/wallet/split payments never block. Blocks if already at/over limit, or if accepting a COD order would push the rider over `paymentLimit - pendingCollection`.
- Concurrent orders are status-derived, not controlled by `maxOrderLimit`: a rider can hold at most two live orders. A rider with any `Rider Accepted` order cannot accept another. After the 30-second idle-rider priority window, a rider with only `Rider Picked Up` live orders may accept another if they have fewer than two. `orderCount` is legacy data and must never be read or written.

Both apps already render active orders as an array (badge = `activeOrders.length`). The GPS location-tracking hook does `activeOrders.find(status === "Rider Picked Up")`, so it only tracks one order if multiple are picked up simultaneously.

**Why this file exists:** a user once pasted a large legacy-looking spec (notifications, emails, admin/super-admin overrides, `riderCurrentOrdersTotal`, `{status,msg}` response shape) that doesn't correspond to this codebase. Keep the actual cash-collection gate and status-derived live-order rules; do not restore the legacy concurrent-order or counter behavior.

**How to apply:** if another pasted "spec" surfaces referencing patterns absent from this repo, grep first before implementing — don't assume it describes existing code here.

## Legacy cash-delivery evidence

Current-day COD deliveries made through legacy/admin clients can have a time-of-day delivery marker but no full rider-owned delivery timestamp. Do not classify aggregate cash as previous-day debt simply because the full timestamp is absent, and do not rely on the mutable shared status.

**Why:** live same-day COD deliveries were omitted from the collection-window check, falsely blocking riders with current-day cash.

**How to apply:** accept either a full delivery timestamp in the collection window, or (when that timestamp is absent) an order created within the window with a nonempty delivery marker. Do not use bulk-written `updatedAt` as delivery evidence.
