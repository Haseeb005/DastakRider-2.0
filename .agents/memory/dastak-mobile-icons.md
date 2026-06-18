---
name: Dastak mobile icons
description: Why the Expo rider app uses lucide SVG icons instead of @expo/vector-icons fonts
---

The rider-mobile (Expo) app renders icons as SVG via `lucide-react-native` (through
`react-native-svg`), NOT via `@expo/vector-icons` icon fonts.

**Why:** The font-based icons (Feather / MaterialCommunityIcons) rendered blank on the
app even after preloading the fonts AND embedding them via the `expo-font` config
plugin. Switching to SVG (lucide) made them paint reliably on web and native with no
font preloading step.

**How to apply:** Add/change icons through `components/Icon.tsx` — a wrapper exposing
`{name,size,color,strokeWidth,style}` keyed by the old Feather-style kebab names,
each mapped to a lucide component. The `IconName` type is derived from that map, so a
missing icon fails at compile time — add the lucide import + map entry first. In
`(tabs)/_layout.tsx` the wrapper is imported aliased as `AppIcon` because
`expo-router/unstable-native-tabs` already exports its own `Icon`. Do not reintroduce
`@expo/vector-icons` or `expo-font` vector-font plugin entries.
