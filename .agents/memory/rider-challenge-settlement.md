---
name: Rider challenge settlement
description: How automatic rider challenge progress and bonus settlement stays correct at PKT period boundaries.
---

Daily and weekly reward levels are independent sequential challenges: completing one starts the next at zero, and each later target requires that many additional deliveries. Stage progress advances without a wallet payout while the period is open. At period end, recount final eligible deliveries and pay exactly one bonus for the highest cumulative stage reached; lower stages are skipped. During the bounded post-deadline grace window, delayed deliveries may upgrade the selected stage and amount, but a settled stage must never downgrade. Older active records expire without payout. Eligibility uses the canonical delivery-completion time, with the order creation time allowed only as a legacy fallback when no completion time exists.

Keep the original period uniqueness strategy and deterministic stage/payout identities. Previous results expose one representative per ended period with explicit pending/paid/not-earned payout truth and a canonical period delivery snapshot. Concurrent readers must wait for in-flight settlement to become durable before reporting payout state. Legacy cumulative records keep their original per-milestone semantics and stored schedules so rollout cannot pay them twice or hide a valid old payout.

**Why:** Shared order writes can become visible just after a rider's first Wallet read at a daily or weekly boundary, and eligible orders may be deleted before initial settlement. Locked migration and stable legacy keys prevent retired cumulative records from being overpaid during rollout.

**How to apply:** Preserve the timestamp fallback, grace bound, settlement lock/read consistency, final delivery recount, one-result history normalization, monotonic settled stage, delivery baseline, period uniqueness, stored legacy schedules, and idempotent payouts whenever changing challenge periods or Wallet refresh behavior. Never rescan unbounded history.