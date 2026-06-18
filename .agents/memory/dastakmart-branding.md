---
name: DastakMart brand theme
description: The canonical DastakMart brand palette/typography to use across Dastak apps
---

# DastakMart brand theme

The DastakMart brand color is **crimson `#DB143C`** (`hsl(348 83% 47%)`) on a white base with cool slate-gray neutrals, **Inter** typeface, and **pill-shaped** primary CTAs.

**Why:** The Dastak rider apps originally shipped with an orange primary, but the user's source of truth is the DastakMart website, whose brand is crimson — not orange. When asked to "match DastakMart," use crimson, not the old orange.

**How to apply:** Drive the brand through the theme tokens (primary/ring/etc.) and a crimson brand color scale; keep semantic colors (green = online/delivered/earnings, blue = picked-up) untouched — only the brand accent is crimson. The web rider app was rethemed this way; the Expo mobile app is a separate React Native styling pass (no shared CSS).
