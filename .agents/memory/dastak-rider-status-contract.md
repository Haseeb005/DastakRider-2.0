---
name: Dastak rider order status contract
description: Backend rules any rider client (web or mobile) must follow when progressing an order through delivery.
---

# Rider order status progression contract

## Availability gate: "Admin Accepted"

An order becomes visible to riders (the available list + the new-order alert) ONLY when its status is `"Admin Accepted"` — NOT `"Pending"`. Full DB flow: `Pending → Admin Accepted → Rider Accepted → Rider Picked Up → Delivered` (or `Rejected`). The backend `AVAILABLE_STATUS` constant gates both `/rider/orders/available` and `/rider/orders/:id/accept`, so both must always reference the same status.

**Why:** admin acceptance is the business trigger for rider visibility; the mobile app's `STATUS_LABELS` already mapped `"Admin Accepted"`→"Ready to Pick" before the gate was wired, confirming the exact string.

**How to apply:** new-order alert beeps for ~15s on both apps; accepting an order must call `stopAlert()` immediately (before the accept mutation) so the beep silences on tap, not on server success.

## Status progression

The `/api/rider/orders/:orderId/status` PUT endpoint is strict. Any client (web app, Expo app, scripts) must follow these rules or it gets 400/409.

- **Exact canonical status strings only.** The endpoint accepts ONLY `"Rider Picked Up"` and `"Delivered"`. Do NOT send snake_case (`rider_picked_up`/`delivered`) — that returns 400. Statuses in this DB are capitalized human strings throughout.
- **`riderArrived` checkpoint is mandatory before pickup.** Progression is: `Rider Accepted` → mark arrived → `Rider Picked Up` → `Delivered`. To go to `Rider Picked Up` the order must already have `riderArrived: true`, set via a SEPARATE call to `/api/rider/orders/:orderId/arrived` (hook `useMarkOrderArrived`). Skipping it returns 409. "Arrived at Restaurant" is an additive checkpoint — the canonical status stays `Rider Accepted` until pickup.
- **Order has `riderArrived?: boolean`** in the `RiderOrder` schema; UI shows an "At Restaurant" badge when `status === "Rider Accepted" && riderArrived`.

**Why:** the backend enforces the 3-step progression server-side to guard against stale clients / direct API calls. The web app encodes the same flow; mobile must mirror it for parity.

**How to apply:** when building or debugging any rider status action, send exact statuses and always wire the arrived step before pickup. Reading only the mutation hook signature is not enough — read the route handler in `artifacts/api-server/src/routes/rider.ts`.
