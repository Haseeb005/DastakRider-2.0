---
name: Dastak monorepo type quirks
description: Cross-package typecheck quirks involving the Expo artifact and React types.
---

# Two @types/react versions are expected (Expo vs catalog)

- The Expo artifact (`artifacts/rider-mobile`) pins `@types/react ~19.1.x` (resolves to 19.1.17) to match its React Native / Expo SDK, while the workspace catalog and web apps use `@types/react ^19.2.x`. Both versions coexist in `node_modules/.pnpm`. This is normal — do not try to "fix" it by force-aligning; Expo needs its pinned types.
- The Expo subtree's 19.1.17 does NOT leak into `artifacts/rider-app` — that app's tree stays on 19.2.x. Verified via lockfile: every 19.1.17 entry is inside expo/react-native dependency keys only.

# Pre-existing rider-app calendar.tsx typecheck failure

- `artifacts/rider-app/src/components/ui/calendar.tsx` fails the root `pnpm run typecheck` with a `react-day-picker` ref-type "Two different types with this name exist, but they are unrelated" error. This is the well-known shadcn calendar + react-day-picker v9 + React 19 types issue and is **pre-existing / unrelated to the Expo app**. Don't assume adding a mobile artifact caused it.

**Why:** wasted effort chasing this as a regression. The lockfile diff proved rider-app's resolution was unchanged.

**How to apply:** when the root typecheck fails only in rider-app's calendar.tsx, treat it as pre-existing web-app debt; verify your own artifact with `pnpm --filter @workspace/<slug> run typecheck` instead.
