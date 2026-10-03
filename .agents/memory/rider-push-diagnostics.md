---
name: Rider push delivery diagnostics
description: Distinguish request acceptance from delivery and compare minimal and customized push payloads.
---

Do not diagnose a general OneSignal outage from queued rider notifications alone. Compare an explicitly authorized minimal/default-settings push with the normal customized payload, and distinguish API acceptance, FCM/APNs handoff, and device-confirmed receipt.

**Why:** A minimal rider test successfully reached FCM while previously queued customized order notifications remained pending. That evidence narrows the investigation but does not identify which customized field or provider setting caused the difference.

**How to apply:** Read notification delivery reports, not just server acceptance logs. A positive successful count means push-provider handoff, not confirmed display on a phone. Inspect invalid saved subscriptions separately. Never send diagnostic pushes without user authorization or publish a native update merely to investigate a server-side delivery problem.