---
name: Customer tracking integration constraint
description: Why Rider GPS and customer tracking use shared MongoDB rather than customer-token forwarding.
---

The customer backend and Rider backend are separate services coupled through
the shared MongoDB database. Customer tracking uses its own trusted session or
bearer identity; Rider tokens must not be assumed valid there.

**Why:** The user supplied the customer tracking reader, which expects shared
persistent rider locations. A successful Rider POST to a process-local cache
cannot satisfy a separate customer reader; absence of customer-server POST logs
alone does not prove the Rider app failed to publish.

**How to apply:** Preserve this shared-storage integration unless an explicitly
authenticated bridge is supplied. Verify both services actually target the same
database before claiming production end-to-end success. Test with genuine rider
device fixes only, never customer GPS, fabricated coordinates or old positions
presented as live. Do not deploy automatically for this tracking request.
