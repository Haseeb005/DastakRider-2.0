---
name: Rider order distribution
description: Fair first-order priority for available rider orders and its concurrency guarantees.
---

When an unassigned order becomes available, offer it simultaneously to online, city/zone-eligible riders who have no active order. Keep this idle-rider priority for 30 seconds. Afterward, also allow riders with picked-up orders, provided they have no order still at `Rider Accepted` and fewer than two live orders. A rider with two active orders cannot accept another. Do not use the admin-set `maxOrderLimit` for this rule.

**Why:** the user wants idle riders to get a fair chance, then let riders who have progressed to pickup accept another order without giving multiple unpicked orders to one rider.

**How to apply:** count live statuses from `orders` (`Rider Accepted` and `Rider Picked Up`) on the server. Enforce the same rules for listing, push targeting, and acceptance. Keep the first-available timestamp stable across polling and serialize acceptance transactions across riders so concurrency cannot bypass the status rule or two-order ceiling.
