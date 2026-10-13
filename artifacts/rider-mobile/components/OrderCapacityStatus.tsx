import type { RiderOrder } from "@workspace/api-client-react";
import React from "react";
import { Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export function OrderCapacityStatus({
  orders,
  orderLimitExempt = false,
}: {
  orders: RiderOrder[];
  orderLimitExempt?: boolean;
}) {
  const c = useColors();
  const liveOrders = orders.filter(
    (order) =>
      order.status === "Rider Accepted" || order.status === "Rider Picked Up",
  );
  const accepted = liveOrders.some((order) => order.status === "Rider Accepted");
  const pickedUp = liveOrders.some((order) => order.status === "Rider Picked Up");
  const full = liveOrders.length >= 2;
  if (orderLimitExempt) {
    return (
      <View
        accessibilityLabel={`${liveOrders.length} live orders. No live-order cap. New orders are offered to idle riders first.`}
        style={{
          marginHorizontal: 20,
          marginTop: 12,
          marginBottom: 12,
          padding: 14,
          borderRadius: c.radius,
          backgroundColor: c.card,
          borderWidth: 1,
          borderColor: c.border,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: c.foreground, fontSize: 14, fontFamily: "Inter_700Bold" }}>
            {liveOrders.length} live order{liveOrders.length === 1 ? "" : "s"}
          </Text>
          <Text style={{ color: c.primary, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>
            No order cap
          </Text>
        </View>
        <Text style={{ color: c.mutedForeground, fontSize: 12, lineHeight: 17, marginTop: 8, fontFamily: "Inter_400Regular" }}>
          You can accept more orders while these are active. Idle riders still get the first 30 seconds to accept new offers.
        </Text>
      </View>
    );
  }
  const message = full && accepted
    ? "At capacity. Pick up the accepted order, then complete a delivery before taking another."
    : full
      ? "Complete a delivery before accepting another order."
      : accepted
      ? "Pick up your accepted order before accepting another."
      : pickedUp
        ? "You may see another order after idle riders' 30-second priority."
        : "New orders are offered to riders with no active deliveries first.";
  const progress = Math.min(liveOrders.length / 2, 1);

  return (
    <View
      accessibilityLabel={`${liveOrders.length} of 2 live orders. ${message}`}
      style={{
        marginHorizontal: 20,
        marginTop: 12,
        marginBottom: 12,
        padding: 14,
        borderRadius: c.radius,
        backgroundColor: c.card,
        borderWidth: 1,
        borderColor: c.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: c.foreground, fontSize: 14, fontFamily: "Inter_700Bold" }}>
          {liveOrders.length} of 2 live orders
        </Text>
        <Text style={{ color: full ? c.warning : c.primary, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>
          {full ? "Capacity full" : `${2 - liveOrders.length} slot${liveOrders.length === 1 ? "" : "s"} open`}
        </Text>
      </View>
      <View
        style={{
          height: 5,
          marginTop: 10,
          marginBottom: 8,
          borderRadius: 3,
          backgroundColor: c.muted,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            width: `${progress * 100}%`,
            height: "100%",
            backgroundColor: full ? c.warning : c.primary,
          }}
        />
      </View>
      <Text style={{ color: c.mutedForeground, fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" }}>
        {message}
      </Text>
    </View>
  );
}
