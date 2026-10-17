import assert from "node:assert/strict";
import test from "node:test";

import { getPushRegistrationViewState } from "../pushRegistrationViewState.mjs";

function result(device = {}) {
  return {
    device: {
      appIdConfigured: true,
      initialized: true,
      permissionGranted: true,
      subscriptionIdPresent: true,
      pushTokenPresent: true,
      optedIn: true,
      riderIdentityMatches: true,
      ...device,
    },
    savedSubscriptionPresent: true,
    matchesCurrentSubscription: true,
    serverCheckFailed: false,
  };
}

test("maps a missing OneSignal app ID to a clear inactive state", () => {
  const state = getPushRegistrationViewState(
    result({
      appIdConfigured: false,
      initialized: false,
      permissionGranted: null,
      subscriptionIdPresent: false,
      pushTokenPresent: false,
      optedIn: null,
      riderIdentityMatches: null,
      errorCode: "missing_app_id",
    }),
  );

  assert.deepEqual(state.appSetup, {
    value: "Missing from this build",
    good: false,
  });
  assert.deepEqual(state.registration, {
    value: "App ID missing",
    good: false,
  });
  assert.equal(state.showMissingAppIdHint, true);
});

test("maps blocked notification permission", () => {
  const state = getPushRegistrationViewState(
    result({
      permissionGranted: false,
      subscriptionIdPresent: false,
      pushTokenPresent: false,
      optedIn: false,
    }),
  );

  assert.deepEqual(state.permission, { value: "Blocked", good: false });
  assert.deepEqual(state.registration, { value: "Not active", good: false });
});

test("treats a missing push token as an inactive device registration", () => {
  const state = getPushRegistrationViewState(
    result({ pushTokenPresent: false }),
  );

  assert.deepEqual(state.registration, { value: "Not active", good: false });
  assert.deepEqual(state.permission, { value: "Allowed", good: true });
});

test("maps a successful device and server registration", () => {
  const state = getPushRegistrationViewState(result());

  assert.deepEqual(state.registration, { value: "Active", good: true });
  assert.deepEqual(state.riderIdentity, { value: "Yes", good: true });
  assert.deepEqual(state.serverSubscription, { value: "Yes", good: true });
  assert.equal(state.showMissingAppIdHint, false);
});

test("maps backend verification failures without claiming the subscription is missing", () => {
  const check = result();
  check.serverCheckFailed = true;

  const state = getPushRegistrationViewState(check);

  assert.deepEqual(state.serverSubscription, {
    value: "Could not check",
    good: null,
  });
});
