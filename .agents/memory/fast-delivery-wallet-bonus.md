---
name: Fast delivery wallet bonus
description: Safety and reconciliation rules for the rider's accepted-to-delivered fast delivery incentive.
---

Fast-delivery bonuses are determined from the server-recorded accepted and delivered timestamps only during a new rider delivery transition. They are persisted as an idempotent per-rider/per-order wallet entry; Wallet reads do not backfill historical orders.

**Why:** The incentive is a forward-looking policy and must not unexpectedly pay prior deliveries. The delivery transition is already committed when a post-delivery wallet write happens, so a Wallet-side historical scan would both violate the policy and create ambiguous recovery behavior.

**How to apply:** Keep bonus persistence additive and non-blocking after new delivery transitions, retain an order-specific unique key compatible with all existing wallet-entry indexes, and never add a historical Wallet scan for this bonus. Include fast bonuses separately in Wallet summaries while adding them to the combined total.