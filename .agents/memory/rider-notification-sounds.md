---
name: Rider notification sounds
description: Native OneSignal sound packaging and payload naming for the rider app
---

The current OneSignal Expo plugin accepts only `.wav` files in its `sounds` configuration, even though the app audio player can play MP3. The push-compatible WAV should be generated from the selected source audio, with the Android payload using the resource name without the extension and iOS using the filename.

**Why:** Passing an MP3 directly to the plugin fails Expo native configuration validation, while Android and iOS still need the sound bundled into the native app.

**How to apply:** Keep the source MP3 for in-app playback if desired, bundle the matching `.wav` through the OneSignal plugin, and use matching `android_sound`/`ios_sound` values in every push path.