import { Feather } from "@expo/vector-icons";
import type { RiderOrder } from "@workspace/api-client-react";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { Badge } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { isCOD, money, statusColors, statusLabel } from "@/lib/format";

export function OrderCard({
  order,
  onPress,
  children,
}: {
  order: RiderOrder;
  onPress?: () => void;
  children?: React.ReactNode;
}) {
  const c = useColors();
  const atRestaurant =
    order.status === "Rider Accepted" && !!order.riderArrived;
  const sc = atRestaurant
    ? { bg: c.infoBg, fg: c.info }
    : statusColors(order.status, c);
  const badgeLabel = atRestaurant ? "At Restaurant" : statusLabel(order.status);
  const itemCount =
    order.items?.reduce((s, i) => s + (i.quantity || 0), 0) ?? 0;
  const cod = isCOD(order.paymentType);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: c.card,
          borderRadius: c.radius,
          borderWidth: 1,
          borderColor: c.border,
          padding: 16,
          marginBottom: 12,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 10,
        }}
      >
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 16,
              color: c.foreground,
            }}
          >
            {order.restaurantName || "Restaurant"}
          </Text>
          {order.orderNum ? (
            <Text
              style={{
                fontFamily: "Inter_400Regular",
                fontSize: 12,
                color: c.mutedForeground,
                marginTop: 2,
              }}
            >
              #{order.orderNum}
            </Text>
          ) : null}
        </View>
        <Badge label={badgeLabel} bg={sc.bg} fg={sc.fg} />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Feather name="map-pin" size={14} color={c.mutedForeground} />
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontFamily: "Inter_400Regular",
            fontSize: 13,
            color: c.foreground,
          }}
        >
          {order.address || "—"}
        </Text>
      </View>

      {order.zone || order.distance ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            marginTop: 6,
          }}
        >
          <Feather name="navigation" size={13} color={c.mutedForeground} />
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontFamily: "Inter_400Regular",
              fontSize: 12,
              color: c.mutedForeground,
            }}
          >
            {[order.zone, order.distance].filter(Boolean).join(" · ")}
          </Text>
        </View>
      ) : null}

      <View
        style={{
          height: 1,
          backgroundColor: c.border,
          marginVertical: 12,
        }}
      />

      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-end",
        }}
      >
        <View>
          <Text
            style={{
              fontFamily: "Inter_400Regular",
              fontSize: 11,
              color: c.mutedForeground,
              marginBottom: 2,
            }}
          >
            Your fare
          </Text>
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 19,
              color: c.success,
            }}
          >
            {money(order.riderFare)}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text
            style={{
              fontFamily: "Inter_400Regular",
              fontSize: 11,
              color: c.mutedForeground,
              marginBottom: 2,
            }}
          >
            Order total
          </Text>
          <Text
            style={{
              fontFamily: "Inter_600SemiBold",
              fontSize: 15,
              color: c.foreground,
            }}
          >
            {money(order.total)}
          </Text>
        </View>
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          marginTop: 12,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            backgroundColor: cod ? c.warningBg : c.muted,
            paddingHorizontal: 9,
            paddingVertical: 4,
            borderRadius: 8,
          }}
        >
          <Feather
            name={cod ? "dollar-sign" : "credit-card"}
            size={12}
            color={cod ? c.warning : c.mutedForeground}
          />
          <Text
            style={{
              fontFamily: "Inter_500Medium",
              fontSize: 11,
              color: cod ? c.warning : c.mutedForeground,
            }}
          >
            {cod ? "Cash on delivery" : order.paymentType || "Paid online"}
          </Text>
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
          }}
        >
          <Feather name="shopping-bag" size={12} color={c.mutedForeground} />
          <Text
            style={{
              fontFamily: "Inter_500Medium",
              fontSize: 11,
              color: c.mutedForeground,
            }}
          >
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </Text>
        </View>
      </View>

      {children ? <View style={{ marginTop: 14 }}>{children}</View> : null}
    </Pressable>
  );
}
