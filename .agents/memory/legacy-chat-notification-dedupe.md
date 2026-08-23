---
name: Legacy chat notification dedupe
description: Why old Dastak chat messages need deterministic identities and how to avoid duplicate rider alerts.
---

Legacy customer messages in the shared `chats` collection may not have an `_id` or `createdAt`. Any client-facing fallback ID must be deterministic from immutable message content and position, and should be hashed so message text is not exposed through an ID.

**Why:** a random fallback ID makes an unchanged legacy message appear new after every poll, repeatedly notifying the rider. In addition, a foreground local notification plus the equivalent OneSignal push produces two system alerts for one message.

**How to apply:** map chat messages using their stored ID when available, otherwise use a deterministic hashed fallback; use the same rule in server-side push dedupe. Let OneSignal provide the one system push, while the foreground app shows its in-app chat banner only.