---
name: Rider live-update feed
description: Routing and authorization rules for mobile order/chat WebSocket updates.
---

The Replit-hosted live feed belongs under the API artifact route at `/api/ws/live`, not the root web route. Mobile sockets must authenticate after opening, and the server must resolve each changed order/chat to its assigned rider before broadcasting.

**Why:** The root route is owned by the static rider web app, so `/ws/live` reaches its HTML fallback instead of an upgrade handler. A public unfiltered change feed also exposes cross-rider document activity and can enable chat enumeration.

**How to apply:** Keep live payloads minimal, reject unauthenticated sockets, enforce the same assignment check on chat REST routes, and retain polling as recovery for missed change-stream events.

Server-side push watchers and rider sockets should share one Mongo change source. Reconnects must resume from the last change token; if Mongo reports that history is no longer resumable, reconcile current push-eligible state and retry that reconciliation until every consumer succeeds.

**Why:** Reopening a fresh change stream after a disconnect silently loses order/chat writes from the retry window. A reconciliation that is merely logged and abandoned on transient failure has the same user-visible result: missing rider alerts.

**How to apply:** Treat a non-resumable reset as pending work, make reconciliation generation-aware when resets overlap, and only acknowledge recovery after all push/live-update consumers complete their scans.