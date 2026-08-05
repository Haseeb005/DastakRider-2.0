/**
 * Dynamic Expo config.
 * Reads ONESIGNAL_APP_ID_RIDER from the build environment (Replit Secrets are
 * available to the Expo CLI process at bundle time) and wires it into the
 * OneSignal plugin and the app's `extra` bundle so runtime code can access it
 * without needing an EXPO_PUBLIC_* variable.
 */

const base = require("./app.json").expo;

const oneSignalAppId = process.env.ONESIGNAL_APP_ID_RIDER ?? "";

/** Strip the standalone expo-notifications plugin — OneSignal's plugin sets up
 *  the same native notification infrastructure, avoiding duplicate manifests. */
const basePlug = (base.plugins ?? []).filter(
  (p) =>
    !(Array.isArray(p) && p[0] === "expo-notifications") &&
    p !== "expo-notifications",
);

module.exports = {
  expo: {
    ...base,
    plugins: [
      ...basePlug,
      [
        "onesignal-expo-plugin",
        {
          mode: "development",
        },
      ],
    ],
    extra: {
      ...(base.extra ?? {}),
      oneSignalAppId,
    },
  },
};
