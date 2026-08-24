---
name: Rider challenge settlement
description: How automatic rider challenge progress and bonus settlement stays correct at PKT period boundaries.
---

Challenge progress and its terminal state must be reconciled under a per-challenge lease. Reconcile active ended challenges and only recently expired challenges within a bounded post-deadline grace window; completed bonus entries remain idempotent through a unique challenge key.

**Why:** Shared order writes can become visible just after a rider's first Wallet read at a daily or weekly boundary. Expiring before settlement can lose a valid reward, while reprocessing every old expiry on every Wallet refresh eventually creates an unbounded query load.

**How to apply:** When changing rider challenge periods, transition rules, or Wallet refresh behavior, preserve a short bounded recovery window, the challenge-specific lock, monotonic progress, and the single unique bonus record. Do not replace this with blanket historical rescans.