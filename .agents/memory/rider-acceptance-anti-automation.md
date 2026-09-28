---
name: Rider acceptance flow
description: Product decision for one-tap acceptance without offer-token or suspicious-activity confirmation checks.
---

Routine rider order acceptance must remain a single tap or click. The server must not gate it on a signed offer token, token expiry, a holding duration, or suspicious-activity confirmation.

**Why:** The user expressly chose immediate acceptance after tapping "Accept order" and declined extra offer/confirmation security. A universal hold irritates legitimate riders. An already installed older app can still enforce its own hold gesture before calling the server; no server change can remove that UI behavior.

**How to apply:** Keep rider authentication, city/zone eligibility, order availability, cash/capacity checks, and atomic single-rider assignment. Continue returning legacy offer tokens while older clients need them to submit accept requests, but do not validate them on acceptance. Do not claim server changes remove a hold gesture from already installed builds; that requires a mobile update.
