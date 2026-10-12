---
name: Available-order privacy
description: Privacy boundary for order details before and after rider acceptance.
---

Before acceptance, a rider may receive the restaurant name, pickup address, restaurant phone, pickup coordinates/navigation, and the customer delivery address/coordinates. For prepaid restaurant orders, the API may also return only the aggregate cash payable to the restaurant: the sum of positive `actualPrice × count` values plus `vatAmount`; do not return product lines. Customer identity, phone, basket contents, other payment totals, fare, notes, order number, and other order metadata remain restricted. Push payloads remain pickup-only.

**Why:** The user confirmed `actualPrice` is the restaurant's per-unit payable price for prepaid restaurant orders and requested the aggregate so riders can prepare the correct cash.

**How to apply:** Enforce this narrow exception server-side in the available-orders API, send no product details or payable amount in push payloads, use a distinct client contract for available orders, and keep full order details behind successful assignment.