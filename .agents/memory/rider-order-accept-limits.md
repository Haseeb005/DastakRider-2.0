---
name: Rider accept-order limits
description: How cash-collection and concurrent-order limits work on the rider order-accept endpoint, and what NOT to port from pasted legacy specs.
---

The rider order-accept endpoint enforces two independent, admin-owned limits on the rider document, both optional (0/missing = unlimited, never block by default):

- `paymentLimit` / `pendingCollection`: only COD orders count against this cash-in-hand limit. Online/wallet/split payments never block. Blocks if already at/over limit, or if accepting a COD order would push the rider over `paymentLimit - pendingCollection`.
- `maxOrderLimit`: caps concurrent active orders a rider can hold (replaces an old hardcoded cap of 1). Confirmed with user: it means "how many orders a rider can accept at a time," not a daily count.

Both apps already render active orders as an array (badge = `activeOrders.length`), so raising `maxOrderLimit` above 1 is UI-compatible — except the GPS location-tracking hook does `activeOrders.find(status === "Rider Picked Up")`, so it only tracks one order if multiple are picked up simultaneously.

**Why this file exists:** a user once pasted a large legacy-looking spec (notifications, emails, admin/super-admin overrides, `riderCurrentOrdersTotal`, `{status,msg}` response shape) that doesn't correspond to anything in this codebase. Investigation confirmed none of those patterns exist anywhere in this repo — it described a different (likely external/legacy) backend. Only the generically-applicable pieces (safe Number conversions, `limit > 0` guards, COD-only gating, atomic race-safe update) were ported into our actual `{message}`-shaped API; the notification/email/admin/`riderCurrentOrdersTotal` parts were correctly skipped as not applicable.

**How to apply:** if another pasted "spec" surfaces referencing patterns absent from this repo, grep first before implementing — don't assume it describes existing code here.
