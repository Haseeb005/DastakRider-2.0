---
name: Rider order distribution
description: Fair first-order priority for available rider orders and its concurrency guarantees.
---

When an unassigned order becomes available, offer it simultaneously to online, city/zone-eligible riders who have no active order. Keep this idle-rider priority for 30 seconds. Afterward, allow normal riders with picked-up orders only if they have no order still at `Rider Accepted` and fewer than two live orders. Two explicitly allowlisted riders are exempt from the live-order ceiling and pickup-before-accept restriction, but still follow idle-rider priority and every other eligibility/financial rule. Do not use the admin-set `maxOrderLimit` for this rule.

Send at most one new-order push per rider for each availability period. The 30-second audience expansion should notify only riders not already notified for that same period, including when multiple API instances are running.

**Why:** the user wants idle riders to get a fair chance, then let progressed riders accept additional work without giving normal riders multiple unpicked orders; two approved accounts have a specific unlimited-order exception.

**Why:** in-memory notification deduplication is not shared between API instances and can allow one rider to receive the same order alert multiple times.

**How to apply:** count live statuses from `orders` (`Rider Accepted` and `Rider Picked Up`) on the server. Enforce the same rules for listing, push targeting, and acceptance. Keep the first-available timestamp stable across polling, use durable per-rider push claims for each availability period, and serialize acceptance transactions across riders so concurrency cannot bypass the status rule or two-order ceiling.
