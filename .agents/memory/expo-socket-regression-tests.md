---
name: Expo socket regression tests
description: How to keep mobile socket lifecycle logic directly testable without breaking Expo configuration loading.
---

Keep reusable mobile socket state machines in a platform-neutral ES module, while the Expo-facing wrapper supplies native storage and environment dependencies.

**Why:** Cross-loading an Expo TypeScript module through another workspace package's TypeScript ESM loader can trigger CommonJS/ESM require cycles. Marking the whole Expo package as ESM is unsafe when its build configuration still uses CommonJS.

**How to apply:** Put dependency-free lifecycle logic behind injected WebSocket/token options in an ES module that both Metro and Node can load; keep React Native imports in the thin Expo wrapper.