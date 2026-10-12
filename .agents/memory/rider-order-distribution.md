---
name: Rider order distribution
description: Fair first-order priority for available rider orders and its concurrency guarantees.
---

When an unassigned order becomes available, offer it simultaneously to online, city/zone-eligible riders who have no active order. If at least one eligible idle rider exists, hold this priority for 30 seconds; then offer the order to all eligible riders still below their admin-set `maxOrderLimit`. If there are no eligible idle riders, open it to all eligible riders immediately. Preserve the hard `maxOrderLimit`; fairness priority never overrides it.

**Why:** the user wants idle riders to get a fair chance without letting one non-responsive rider hide an order from other idle riders; after 30 seconds, orders should not remain blocked.

**How to apply:** enforce visibility and acceptance eligibility on the server, not only in the apps. Keep the first-available timestamp stable across polling and serialize acceptance transactions across riders so concurrent accepts cannot bypass the priority or order cap. Push notifications should use the same audience and broaden after the priority window.
