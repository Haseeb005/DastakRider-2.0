export function getPushRegistrationViewState(result) {
  const { device } = result;
  const devicePushReady =
    device.subscriptionIdPresent &&
    device.pushTokenPresent &&
    device.optedIn === true;

  return {
    appSetup: {
      value: device.appIdConfigured ? "Configured" : "Missing from this build",
      good: device.appIdConfigured,
    },
    permission: {
      value:
        device.permissionGranted === null
          ? "Could not check"
          : device.permissionGranted
            ? "Allowed"
            : "Blocked",
      good: device.permissionGranted,
    },
    registration: {
      value:
        device.errorCode === "missing_app_id"
          ? "App ID missing"
          : device.errorCode === "not_initialized"
            ? "SDK not initialized"
            : device.errorCode === "sdk_read_failed"
              ? "Could not read"
              : devicePushReady
                ? "Active"
                : "Not active",
      good: device.errorCode ? false : devicePushReady,
    },
    riderIdentity: {
      value:
        device.riderIdentityMatches === null
          ? "Could not check"
          : device.riderIdentityMatches
            ? "Yes"
            : "No",
      good: device.riderIdentityMatches,
    },
    serverSubscription: {
      value: result.serverCheckFailed
        ? "Could not check"
        : result.matchesCurrentSubscription
          ? "Yes"
          : result.savedSubscriptionPresent
            ? "Saved ID does not match"
            : "No subscription saved",
      good: result.serverCheckFailed
        ? null
        : result.matchesCurrentSubscription,
    },
    showMissingAppIdHint: device.errorCode === "missing_app_id",
  };
}
