---
name: Available-order privacy
description: Privacy boundary for order details before and after rider acceptance.
---

Before acceptance, a rider may receive only the restaurant name, pickup address, restaurant phone, and pickup coordinates/navigation. Customer identity and destination, basket contents, payment and totals, fare, notes, order number, and other order metadata must not be returned or pushed. Full permitted details begin only after a successful accept.

**Why:** UI-only hiding is bypassable through direct API access and notifications can independently leak details.

**How to apply:** Enforce the restricted shape in the available-orders API, use a distinct client contract for available orders, and keep full order responses behind successful assignment to that rider. New-order pushes may identify only the generic destination screen plus restaurant context; do not include a per-order identifier or other order metadata.