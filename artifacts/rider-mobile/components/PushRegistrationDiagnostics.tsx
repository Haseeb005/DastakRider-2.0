import { ActivityIndicator, Linking, Platform, Text, TouchableOpacity, View } from "react-native";
import { useState } from "react";

import { useColors } from "@/hooks/useColors";
import { API_BASE_URL } from "@/lib/apiBase";
import { useAuth } from "@/lib/auth";
import { getPushRegistrationDiagnostics } from "@/lib/onesignal";

type DeviceStatus = Awaited<ReturnType<typeof getPushRegistrationDiagnostics>>;

interface CheckResult {
  device: Omit<DeviceStatus, "subscriptionId">;
  savedSubscriptionPresent: boolean | null;
  matchesCurrentSubscription: boolean | null;
  serverCheckFailed: boolean;
}

function StatusLine({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good: boolean | null;
}) {
  const c = useColors();
  const color = good === true ? c.success : good === false ? c.warning : c.mutedForeground;
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <Text style={{ flex: 1, fontFamily: "Inter_400Regular", fontSize: 13, color: c.mutedForeground }}>
        {label}
      </Text>
      <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color, textAlign: "right" }}>
        {value}
      </Text>
    </View>
  );
}

export function PushRegistrationDiagnostics({ riderId }: { riderId: string }) {
  const c = useColors();
  const { token } = useAuth();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);

  const checkRegistration = async () => {
    setChecking(true);
    try {
      const device = await getPushRegistrationDiagnostics(riderId);
      const { subscriptionId, ...safeDevice } = device;
      let savedSubscriptionPresent: boolean | null = null;
      let matchesCurrentSubscription: boolean | null = null;
      let serverCheckFailed = false;

      if (token) {
        try {
          const response = await fetch(`${API_BASE_URL}/api/rider/player-id/verify`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ playerId: subscriptionId }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const server = (await response.json()) as {
            savedSubscriptionPresent?: boolean;
            matchesCurrentSubscription?: boolean;
          };
          savedSubscriptionPresent = server.savedSubscriptionPresent === true;
          matchesCurrentSubscription = server.matchesCurrentSubscription === true;
        } catch {
          serverCheckFailed = true;
        }
      } else {
        serverCheckFailed = true;
      }

      setResult({
        device: safeDevice,
        savedSubscriptionPresent,
        matchesCurrentSubscription,
        serverCheckFailed,
      });
    } finally {
      setChecking(false);
    }
  };

  const permission = result?.device.permissionGranted ?? null;
  const devicePushReady =
    result?.device.subscriptionIdPresent === true &&
    result.device.pushTokenPresent &&
    result.device.optedIn === true;

  return (
    <View
      style={{
        backgroundColor: c.card,
        borderRadius: c.radius,
        borderWidth: 1,
        borderColor: c.border,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 16, color: c.foreground }}>
        Notification setup
      </Text>
      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, color: c.mutedForeground, marginTop: 4 }}>
        Check whether this phone is registered to receive rider alerts.
      </Text>

      {result && (
        <View style={{ marginTop: 14, gap: 10 }}>
          <StatusLine
            label="OneSignal app setup"
            value={result.device.appIdConfigured ? "Configured" : "Missing from this build"}
            good={result.device.appIdConfigured}
          />
          <StatusLine
            label="Notification permission"
            value={permission === null ? "Could not check" : permission ? "Allowed" : "Blocked"}
            good={permission}
          />
          <StatusLine
            label="OneSignal device registration"
            value={
              result.device.errorCode === "missing_app_id"
                ? "App ID missing"
                : result.device.errorCode === "not_initialized"
                  ? "SDK not initialized"
                  : result.device.errorCode === "sdk_read_failed"
                    ? "Could not read"
                    : devicePushReady
                      ? "Active"
                      : "Not active"
            }
            good={result.device.errorCode ? false : devicePushReady}
          />
          <StatusLine
            label="Linked to this rider"
            value={
              result.device.riderIdentityMatches === null
                ? "Could not check"
                : result.device.riderIdentityMatches
                  ? "Yes"
                  : "No"
            }
            good={result.device.riderIdentityMatches}
          />
          <StatusLine
            label="Server has this phone’s subscription"
            value={
              result.serverCheckFailed
                ? "Could not check"
                : result.matchesCurrentSubscription
                  ? "Yes"
                  : result.savedSubscriptionPresent
                    ? "Saved ID does not match"
                    : "No subscription saved"
            }
            good={
              result.serverCheckFailed
                ? null
                : result.matchesCurrentSubscription
            }
          />
          {result.device.errorCode === "missing_app_id" && (
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, color: c.warning }}>
              This installed build needs the OneSignal app ID in its production build environment.
            </Text>
          )}
        </View>
      )}

      <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Check notification setup"
          onPress={checkRegistration}
          disabled={checking}
          style={{
            flex: 1,
            minHeight: 44,
            borderRadius: 12,
            backgroundColor: c.primary,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 12,
            opacity: checking ? 0.65 : 1,
          }}
        >
          {checking ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#FFFFFF" }}>
              Check notification setup
            </Text>
          )}
        </TouchableOpacity>
        {Platform.OS !== "web" && permission === false && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open notification settings"
            onPress={() => Linking.openSettings().catch(() => {})}
            style={{
              minHeight: 44,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: c.border,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 12,
            }}
          >
            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: c.foreground }}>
              Open settings
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
