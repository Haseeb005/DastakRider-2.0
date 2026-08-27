---
name: Rider challenge settlement
description: How automatic rider challenge progress and bonus settlement stays correct at PKT period boundaries.
---

Daily and weekly reward levels are independent sequential challenges: completing one starts the next at zero, and each later target requires that many additional deliveries. Reconcile each challenge under a lease, migrate legacy cumulative records before running progress settlement, and preserve only rewards already marked or recorded as earned. Active and recently expired challenges may settle only inside the bounded post-deadline grace window; older active records expire without payout.

Keep the original unique rider/kind/period-key constraint. Sequence zero uses the base period key and legacy milestone payout key; later levels use deterministic sequence-suffixed period keys plus a base-period lookup field.

**Why:** Shared order writes can become visible just after a rider's first Wallet read at a daily or weekly boundary. Locked migration prevents retired cumulative thresholds from being paid from surplus rides. Compatible keys let old and new API workers coexist during rollout without duplicate challenge records or rewards.

**How to apply:** Preserve the grace bound, challenge lease, delivery baseline, unique period constraint, and idempotent payout keys whenever changing challenge periods or Wallet refresh behavior. Never drop the live unique period index from a request path or rescan unbounded history.