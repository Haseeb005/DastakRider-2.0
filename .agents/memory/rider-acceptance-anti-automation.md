---
name: Rider acceptance anti-automation
description: Product decision for keeping order acceptance fast while adding server-enforced abuse controls.
---

Routine rider order acceptance must remain a single tap or click. Do not require every rider to hold the button for a fixed duration. A second confirmation is required only when the API identifies suspiciously rapid or repeated acceptance behavior.

**Why:** The user confirmed that a universal 1.2-second hold would irritate legitimate riders. Anti-automation must be enforced primarily by the server rather than by adding routine friction.

**How to apply:** Keep short-lived rider- and order-bound offers, atomic order assignment, replay resistance, and rate controls as the baseline. If a request crosses the suspicious-activity threshold, issue a short-lived confirmation for that rider and order; the client must ask for an explicit second action before retrying. Never downgrade normal riders to a mandatory hold without a new product decision.