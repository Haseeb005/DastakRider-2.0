# Dastak Rider

Food-delivery rider apps for Pakistan: a web rider app and an Expo mobile app, both backed by the same Express API server and the shared production MongoDB.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/routes/rider.ts` — all rider API endpoints + auth (source of truth for the status/cash contract)
- `artifacts/rider-app` — web rider app (Vite + React), served at `/`
- `artifacts/rider-mobile` — Expo mobile rider app, served at `/rider-mobile/`
- `lib/api-spec/openapi.yaml` — API contract; `lib/api-client-react` & `lib/api-zod` are generated from it
- Real data lives in the shared production MongoDB (`MONGODB_URI`); riders are `users` with `type:"rider"`.

## Architecture decisions

- Mobile cannot use session cookies, so login/register also return an HMAC-signed bearer token (signed with `SESSION_SECRET`). The web app keeps using session cookies; bearer auth is an additive fallback. `SESSION_SECRET` is required — the server fails fast if it is missing.
- All writes to the shared production DB are additive only (timestamps, additive checkpoints like `riderArrived`). Never compute or overwrite admin-owned fields (`pendingCollection`, `unpaidCollection`) or canonical counters.
- Order progression is enforced server-side: `Rider Accepted` → mark arrived → `Rider Picked Up` → `Delivered`. See the rider status contract in `.agents/memory/`.
- The Expo app pins `@types/react ~19.1.x` (Expo SDK requirement); the web/catalog use `19.2.x`. Both coexisting is expected.

## Product

- **Rider auth**: register/login by phone + password, with city and vehicle selection (mobile).
- **Available orders**: go online/offline, see and accept pending orders, with new-order sound + haptic alerts.
- **Active deliveries**: mark arrived at restaurant, picked up, delivered; live GPS location sharing while in transit.
- **History & earnings**: delivery history with period filters and earnings/ratings summary.
- **Profile**: cash-collection summary (read-only), rating, logout.

## User preferences

- All app UI copy must be in English only — no Urdu / Roman Urdu or any other language in fields, labels, or messages.
- No self-registration: riders cannot register from the web or mobile app (login only).

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
