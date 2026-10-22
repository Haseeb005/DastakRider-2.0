---
name: Rider push eligibility
description: Rider availability rules for every server-side OneSignal push.
---

Before sending any server-side rider push, recheck that each recipient is a non-deleted rider with `isOnline: true`. If current online status cannot be verified, do not send. Apply this to new-order and customer-chat pushes; being in the app background does not itself mean a rider is offline.

**Why:** the user requires offline riders to receive no push notifications.

**How to apply:** filter recipients immediately before calling OneSignal using the shared `users` collection. Treat the stored `isOnline` flag as the source of truth and fail closed on a database lookup error. A status change can still race with the external provider request after the final check.
