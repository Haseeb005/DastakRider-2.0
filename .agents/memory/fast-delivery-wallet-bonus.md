---
name: Fast delivery wallet bonus
description: Safety and reconciliation rules for the rider's accepted-to-delivered fast delivery incentive.
---

Fast-delivery bonuses are based only on server-recorded acceptance and delivery timestamps: award Rs 50 when delivery is completed within 20 minutes, with no GPS/geofence requirement. Award only during a new rider delivery transition and persist as an idempotent per-rider/per-order wallet entry; Wallet reads do not backfill historical orders.

**Why:** The user explicitly chose time-only eligibility because GPS availability and distance were preventing otherwise-fast deliveries from receiving the incentive. The delivery transition is already committed when a post-delivery wallet write happens, so Wallet-side historical scans would create ambiguous recovery behavior.

**How to apply:** Keep bonus persistence additive and non-blocking after new delivery transitions, retain an order-specific unique key compatible with all existing wallet-entry indexes, and never add a historical Wallet scan or automatic backfill for this bonus. A manually approved historical correction is a separate financial action. Include fast bonuses separately in Wallet summaries while adding them to the combined total.