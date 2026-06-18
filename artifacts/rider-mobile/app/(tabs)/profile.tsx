import { Feather } from "@expo/vector-icons";
import {
  getGetRiderMeQueryKey,
  useGetRiderMe,
  useLogoutRider,
  useUpdateRiderAvailability,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import React from "react";
import {
  Alert,
  Platform,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";

import { Button, Loading, ScreenHeader } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/format";

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  value: string;
}) {
  const c = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 10,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: c.muted,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name={icon} size={16} color={c.mutedForeground} />
      </View>
      <Text
        style={{
          flex: 1,
          fontFamily: "Inter_400Regular",
          fontSize: 14,
          color: c.mutedForeground,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontFamily: "Inter_600SemiBold",
          fontSize: 14,
          color: c.foreground,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function CollectionCard({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: "warning" | "info";
}) {
  const c = useColors();
  const bg = tone === "warning" ? c.warningBg : c.infoBg;
  const fg = tone === "warning" ? c.warning : c.info;
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: bg,
        borderRadius: c.radius,
        padding: 14,
      }}
    >
      <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: fg }}>
        {label}
      </Text>
      <Text
        style={{
          fontFamily: "Inter_700Bold",
          fontSize: 20,
          color: fg,
          marginTop: 6,
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          fontFamily: "Inter_400Regular",
          fontSize: 11,
          color: fg,
          marginTop: 4,
          opacity: 0.85,
        }}
      >
        {note}
      </Text>
    </View>
  );
}

export default function ProfileScreen() {
  const c = useColors();
  const qc = useQueryClient();
  const { signOut } = useAuth();

  const meQ = useGetRiderMe();
  const rider = meQ.data;
  const isOnline = !!rider?.isOnline;

  const availabilityM = useUpdateRiderAvailability();
  const logoutM = useLogoutRider();

  const toggleOnline = () => {
    Haptics.selectionAsync().catch(() => {});
    availabilityM.mutate(
      { data: { isOnline: !isOnline } },
      {
        onSuccess: () =>
          qc.invalidateQueries({ queryKey: getGetRiderMeQueryKey() }),
      },
    );
  };

  const confirmLogout = () => {
    Alert.alert("Logout?", "You will be signed out of your account.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: () => logoutM.mutate(undefined, { onSettled: () => signOut() }),
      },
    ]);
  };

  if (meQ.isLoading || !rider) return <Loading />;

  const initials = (rider.name || "R")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title="Profile" />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 4,
          paddingBottom: Platform.OS === "web" ? 120 : 110,
        }}
      >
        <View
          style={{
            backgroundColor: c.card,
            borderRadius: c.radius,
            borderWidth: 1,
            borderColor: c.border,
            padding: 18,
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <View
            style={{
              width: 76,
              height: 76,
              borderRadius: 38,
              backgroundColor: c.primary,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 12,
            }}
          >
            <Text
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 28,
                color: "#FFFFFF",
              }}
            >
              {initials}
            </Text>
          </View>
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 20,
              color: c.foreground,
            }}
          >
            {rider.name}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginTop: 4,
            }}
          >
            <Feather name="star" size={14} color={c.warning} />
            <Text
              style={{
                fontFamily: "Inter_500Medium",
                fontSize: 13,
                color: c.mutedForeground,
              }}
            >
              {(rider.rating ?? 0).toFixed(1)} ({rider.ratingCount ?? 0}) ·{" "}
              {rider.totalDeliveries ?? 0} deliveries
            </Text>
          </View>
        </View>

        <View
          style={{
            backgroundColor: c.card,
            borderRadius: c.radius,
            borderWidth: 1,
            borderColor: c.border,
            padding: 16,
            marginBottom: 16,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: isOnline ? c.success : c.mutedForeground,
              }}
            />
            <Text
              style={{
                fontFamily: "Inter_600SemiBold",
                fontSize: 15,
                color: c.foreground,
              }}
            >
              {isOnline ? "Online — receiving orders" : "Offline"}
            </Text>
          </View>
          <Switch
            value={isOnline}
            onValueChange={toggleOnline}
            disabled={availabilityM.isPending}
            trackColor={{ false: c.input, true: c.success }}
            thumbColor="#FFFFFF"
          />
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
          <CollectionCard
            label="Cash in hand"
            value={money(rider.pendingCollection)}
            note="Collected from active orders"
            tone="warning"
          />
          <CollectionCard
            label="Owed to company"
            value={money(rider.unpaidCollection)}
            note="Unpaid so far"
            tone="info"
          />
        </View>

        <View
          style={{
            backgroundColor: c.card,
            borderRadius: c.radius,
            borderWidth: 1,
            borderColor: c.border,
            paddingHorizontal: 16,
            paddingVertical: 4,
            marginBottom: 16,
          }}
        >
          <InfoRow icon="phone" label="Phone" value={rider.phone} />
          <View style={{ height: 1, backgroundColor: c.border }} />
          <InfoRow icon="map-pin" label="City" value={rider.city} />
          <View style={{ height: 1, backgroundColor: c.border }} />
          <InfoRow icon="truck" label="Vehicle" value={rider.vehicleType} />
          <View style={{ height: 1, backgroundColor: c.border }} />
          <InfoRow
            icon="dollar-sign"
            label="Total earnings"
            value={money(rider.totalEarnings)}
          />
        </View>

        <Button
          label="Logout"
          icon="log-out"
          variant="destructive"
          loading={logoutM.isPending}
          onPress={confirmLogout}
        />
      </ScrollView>
    </View>
  );
}
