---
name: Expo API hostname separation
description: Prevent standalone mobile releases from depending on a temporary Replit workspace hostname.
---

Never use the Expo bundle host as the native app's API host. Resolve REST, chat, location, and WebSocket traffic from the explicit permanent API URL, with a safe published-API fallback.

**Why:** Replit can inject a temporary `*.replit.dev` value as the Expo bundle domain. If that value is compiled into a Play Store build as the API host, the installed app only works while the workspace is open.

**How to apply:** Keep bundle delivery and API routing separate. Before releasing Android, inspect the exported bundle and confirm it contains the permanent `*.replit.app` API hostname and no workspace `*.replit.dev` hostname.