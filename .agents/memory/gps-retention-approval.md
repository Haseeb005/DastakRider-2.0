---
name: GPS retention approval boundary
description: User-approved scope for shared rider GPS retention work.
---

The user chose “Prepare policy and audit only” for shared rider GPS retention.
Do not treat the five-minute TTL proposal as permission to enable deletion,
backfill timestamps, or perform cleanup.

**Why:** The user explicitly limited this work to preparation; the collection is
shared with the separate customer service.

**How to apply:** Obtain new explicit maintenance approval after reviewing the
read-only audit and customer-service compatibility. Do not enable GPS expiry
automatically at startup or deployment.
