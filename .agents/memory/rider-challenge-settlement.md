---
name: Rider challenge settlement
description: How automatic rider challenge progress and bonus settlement stays correct at PKT period boundaries.
---

Daily and weekly reward levels are independent sequential challenges: completing one starts the next at zero, and each later target requires that many additional deliveries. Stage progress advances without a wallet payout while the period is open. At period end, recount final eligible deliveries and pay exactly one bonus for the highest cumulative stage reached; lower stages are skipped. During the bounded post-deadline grace window, delayed deliveries may upgrade the selected stage and amount, but a settled stage must never downgrade. Older active records expire without payout.

Keep the original unique rider/kind/period-key constraint. Sequence zero uses the base period key; later levels use deterministic sequence-suffixed period keys plus a base-period lookup field. A sequential period uses one deterministic highest-reward payout key. Legacy cumulative records keep their original per-milestone payout keys and semantics so rollout cannot pay them twice.

**Why:** Shared order writes can become visible just after a rider's first Wallet read at a daily or weekly boundary, and eligible orders may be deleted before initial settlement. Locked migration and stable legacy keys prevent retired cumulative records from being overpaid during rollout.

**How to apply:** Preserve the grace bound, period lease, final delivery recount, monotonic settled stage, delivery baseline, unique period constraint, and idempotent payout keys whenever changing challenge periods or Wallet refresh behavior. Never drop the live unique period index from a request path or rescan unbounded history.