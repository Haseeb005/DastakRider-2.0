---
name: Rider push delivery diagnostics
description: Distinguish request acceptance from delivery and compare minimal and customized push payloads.
---

Do not diagnose a general OneSignal outage from queued rider notifications alone. Compare an explicitly authorized minimal/default-settings push with the normal customized payload, and distinguish API acceptance, FCM/APNs handoff, and device-confirmed receipt.

**Why:** A minimal rider test successfully reached FCM while previously queued customized order notifications remained pending. That evidence narrows the investigation but does not identify which customized field or provider setting caused the difference.

**How to apply:** Read notification delivery reports, not just server acceptance logs. A positive successful count means push-provider handoff, not confirmed display on a phone. Inspect invalid saved subscriptions separately. Never send diagnostic pushes without user authorization or publish a native update merely to investigate a server-side delivery problem.

Compare historical recipient IDs with the rider's currently saved subscription before interpreting a prior test as testing the current registration.

**Why:** A rider's OneSignal user can contain several registrations for the same handset, including an old invalid registration and a newer enabled one. Device registration can update the database during diagnosis, so an earlier test may have targeted an invalid ID even when the current saved ID is valid.

**How to apply:** Verify ownership and enabled/token state of the exact saved subscription. Compare the notification report's actual recipient IDs with that subscription; user-level identity matching or the existence of some enabled subscription is not sufficient.

When only one rider reports the default sound and others hear the custom sound, prioritize that device's Android notification-channel and system sound settings over shared payload or release-build changes.

**Why:** The user clarified that this sound issue affected only one rider, while the sound-enabled push was accepted and received.

**How to apply:** Confirm the rider's channel is set to Alerting with the custom Dastak sound, plus notification volume and Do Not Disturb, before making a global native-build change.

Android locks a notification category's sound after the device first receives that category. A device sound picker may offer system tones but not an app-bundled sound resource.

**Why:** This rider's Dastak category was already created with the device-default sound; the delivered test payload requested Dastak, but Android played its locked default.

**How to apply:** To apply a bundled custom sound to an existing device, create a new OneSignal Android category with sound `dastak` (without `.wav`) and send on its new channel ID. Consider the delivery scope carefully when replacing a channel ID shared by all riders.

If foreground alerts play Dastak but background alerts use the default tone for all riders, foreground audio and Android channel audio are separate paths. The raw WAV must also survive Android release resource shrinking.

**Why:** Foreground order alerts play the bundled file directly, while Android renders background pushes from its notification category; the rider build enabled resource shrinking without a keep rule for the dynamically named sound.

**How to apply:** Configure a new shared OneSignal Android category with Custom `dastak`, update the server's channel ID, and preserve `res/raw/dastak.wav` in the next Android release build.