import { Icon } from "@/components/Icon";
import type { RiderOrder } from "@workspace/api-client-react";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { Badge } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import {
  formatDateTime,
  isCOD,
  money,
  statusColors,
  statusLabel,
} from "@/lib/format";

function initials(name?: string | null): string {
  const n = (name ?? "").trim();
  if (!n) return "?";
  const words = n.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

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
  const dt = formatDateTime(order.createdAt);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: c.card,
          borderRadius: 24,
          borderWidth: 1,
          borderColor: c.border,
          padding: 18,
          marginBottom: 16,
          opacity: pressed ? 0.95 : 1,
        },
      ]}
    >
      {/* Timestamp: when the order came in (PKT) */}
      {dt ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            marginBottom: 12,
          }}
        >
          <Icon name="clock" size={13} color={c.mutedForeground} />
          <Text
            style={{
              fontFamily: "Inter_500Medium",
              fontSize: 12.5,
              color: c.mutedForeground,
            }}
          >
            {dt.date} · {dt.time}
          </Text>
        </View>
      ) : null}

      {/* Top: status + payment badges */}
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 18,
        }}
      >
        <Badge label={badgeLabel} bg={sc.bg} fg={sc.fg} />
        <Badge
          label={cod ? "COD" : order.paymentType || "Online"}
          bg={cod ? c.purpleBg : c.infoBg}
          fg={cod ? c.purple : c.info}
        />
      </View>

      {/* Route timeline */}
      <View style={{ position: "relative" }}>
        {/* Connector line behind the tiles */}
        <View
          style={{
            position: "absolute",
            left: 21,
            top: 22,
            bottom: 22,
            width: 2,
            backgroundColor: c.border,
            borderRadius: 1,
          }}
        />

        {/* Pickup */}
        <View
          style={{ flexDirection: "row", gap: 12, marginBottom: 14 }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              backgroundColor: c.primary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                fontFamily: "Inter_800ExtraBold",
                fontSize: 13,
                color: "#FFFFFF",
              }}
            >
              {initials(order.restaurantName)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 10,
                letterSpacing: 0.8,
                color: c.mutedForeground,
                textTransform: "uppercase",
                marginBottom: 1,
              }}
            >
              Pickup
            </Text>
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
                }}
              >
                #{order.orderNum}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Dropoff */}
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              backgroundColor: c.muted,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="map-pin" size={20} color={c.mutedForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 10,
                letterSpacing: 0.8,
                color: c.mutedForeground,
                textTransform: "uppercase",
                marginBottom: 1,
              }}
            >
              Dropoff
            </Text>
            <Text
              numberOfLines={2}
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 15,
                color: c.foreground,
                lineHeight: 20,
              }}
            >
              {order.address || "—"}
            </Text>
            {order.zone || order.distance ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  marginTop: 2,
                }}
              >
                <Icon name="navigation" size={12} color={c.primary} />
                <Text
                  numberOfLines={1}
                  style={{
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 12,
                    color: c.primary,
                  }}
                >
                  {[order.zone, order.distance].filter(Boolean).join(" · ")}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {/* Footer: customer bill + items, dashed divider */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 16,
          paddingTop: 16,
          borderTopWidth: 1,
          borderTopColor: c.border,
          borderStyle: "dashed",
        }}
      >
        <View>
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 10,
              letterSpacing: 0.8,
              color: c.mutedForeground,
              textTransform: "uppercase",
              marginBottom: 1,
            }}
          >
            Customer Bill
          </Text>
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 15,
              color: c.foreground,
            }}
          >
            {money(order.total)}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Icon name="shopping-bag" size={13} color={c.mutedForeground} />
          <Text
            style={{
              fontFamily: "Inter_500Medium",
              fontSize: 12,
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
