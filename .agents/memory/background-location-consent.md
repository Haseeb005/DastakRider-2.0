---
name: Background-location consent
description: Play policy constraint for requesting the rider app's Android background location permission.
---

Request Android background location only after the rider has tapped the affirmative action on a dedicated, prominent in-app disclosure screen. Never request it automatically when restoring an active delivery or starting the tracking hook.

**Why:** Google Play rejected the app when an automatic permission flow did not guarantee that the disclosure appeared immediately before the system permission screen.

**How to apply:** Foreground tracking may begin with foreground permission. Check existing background permission when delivery tracking starts, but send the rider through the explicit pickup/consent flow before making any new background-permission request.