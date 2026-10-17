import type { PushRegistrationDiagnostics } from "./onesignal.native";

export type PushRegistrationDeviceState = Omit<
  PushRegistrationDiagnostics,
  "subscriptionId"
>;

export interface PushRegistrationCheckResult {
  device: PushRegistrationDeviceState;
  savedSubscriptionPresent: boolean | null;
  matchesCurrentSubscription: boolean | null;
  serverCheckFailed: boolean;
}

export interface PushRegistrationViewState {
  appSetup: { value: string; good: boolean };
  permission: { value: string; good: boolean | null };
  registration: { value: string; good: boolean };
  riderIdentity: { value: string; good: boolean | null };
  serverSubscription: { value: string; good: boolean | null };
  showMissingAppIdHint: boolean;
}

export function getPushRegistrationViewState(
  result: PushRegistrationCheckResult,
): PushRegistrationViewState;
