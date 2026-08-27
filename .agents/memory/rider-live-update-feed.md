---
name: Rider live-update feed
description: Routing and authorization rules for mobile order/chat WebSocket updates.
---

The Replit-hosted live feed belongs under the API artifact route at `/api/ws/live`, not the root web route. Mobile sockets must authenticate after opening, and the server must resolve each changed order/chat to its assigned rider before broadcasting.

**Why:** The root route is owned by the static rider web app, so `/ws/live` reaches its HTML fallback instead of an upgrade handler. A public unfiltered change feed also exposes cross-rider document activity and can enable chat enumeration.

**How to apply:** Keep live payloads minimal, reject unauthenticated sockets, enforce the same assignment check on chat REST routes, and retain polling as recovery for missed change-stream events.