---
name: Expo pure-state tests
description: How to test platform-independent Expo app state logic with Node without loading native modules.
---

For platform-independent logic used by the Expo app, a small native `.mjs` helper with a paired `.d.mts` declaration can be tested directly with Node's built-in test runner. Keep the helper free of native SDK imports.

**Why:** The rider mobile package uses CommonJS package defaults while the API package uses ESM. Under Node 24, loading a cross-package `.ts` test through `tsx/esm` produced loader cycles and missing named exports.

**How to apply:** Extract pure mapping or state-transition logic into `.mjs`, keep its TypeScript contract in `.d.mts`, and run `.mjs` tests directly with `node --test`.
