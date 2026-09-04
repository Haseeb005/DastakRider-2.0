---
name: Available-order privacy
description: Privacy boundary for order details before and after rider acceptance.
---

Before acceptance, a rider may receive the restaurant name, pickup address, restaurant phone, pickup coordinates/navigation, and the customer delivery address/coordinates. Customer identity, phone, basket contents, payment and totals, fare, notes, order number, and other order metadata must not be returned or pushed. Full permitted details begin only after a successful accept.

**Why:** UI-only hiding is bypassable through direct API access and notifications can independently leak details.

**How to apply:** Enforce the restricted shape in the available-orders API, expose destination only as delivery address/coordinates, keep push payloads pickup-only, use a distinct client contract for available orders, and keep the full detail view behind successful assignment.