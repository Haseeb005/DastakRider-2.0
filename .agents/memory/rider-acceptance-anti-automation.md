---
name: Rider acceptance flow
description: One-tap acceptance with a short server cooldown against rapid repeat accepts.
---

Routine rider order acceptance must remain a single tap or click. The server must not gate it on a signed offer token, token expiry, a holding duration, or suspicious-activity confirmation.

**Why:** The user wants a one-tap flow but asked the server to reject repeated rapid accepts, avoiding extra steps for each order. This cooldown only deters repeated requests; it cannot prove that a human, rather than an automated client, made the first request.

**How to apply:** Keep rider authentication, city/zone eligibility, order availability, cash/capacity checks, and atomic single-rider assignment. Keep acceptance one tap. Apply the server-side cooldown only after a successful accept, and do not claim this is reliable clicker detection. Continue returning legacy offer tokens while older clients need them, but do not validate them on acceptance.
