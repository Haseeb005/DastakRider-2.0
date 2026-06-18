import { Feather } from "@expo/vector-icons";
import type { OrderItem, RiderOrder } from "@workspace/api-client-react";
import React, { useState } from "react";
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Badge } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import {
  isCOD,
  money,
  parseItemName,
  statusColors,
  statusLabel,
} from "@/lib/format";

function Row({
  label,
  value,
  strong,
  color,
}: {
  label: string;
  value: string;
  strong?: boolean;
  color?: string;
}) {
  const c = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: 6,
      }}
    >
      <Text
        style={{
          fontFamily: "Inter_400Regular",
          fontSize: 13,
          color: c.mutedForeground,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontFamily: strong ? "Inter_700Bold" : "Inter_500Medium",
          fontSize: strong ? 15 : 13,
          color: color ?? c.foreground,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const c = useColors();
  return (
    <View style={{ marginTop: 18 }}>
      <Text
        style={{
          fontFamily: "Inter_600SemiBold",
          fontSize: 12,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          color: c.mutedForeground,
          marginBottom: 8,
        }}
      >
        {title}
      </Text>
      <View
        style={{
          backgroundColor: c.card,
          borderRadius: c.radius,
          borderWidth: 1,
          borderColor: c.border,
          padding: 14,
        }}
      >
        {children}
      </View>
    </View>
  );
}

export function OrderDetailModal({
  order,
  visible,
  onClose,
}: {
  order: RiderOrder | null;
  visible: boolean;
  onClose: () => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 20 : insets.top + 6;
  const [dealItem, setDealItem] = useState<OrderItem | null>(null);

  if (!order) return null;
  const sc = statusColors(order.status, c);
  const cod = isCOD(order.paymentType);

  const handleClose = () => {
    setDealItem(null);
    onClose();
  };

  const callPhone = (phone?: string | null) => {
    if (phone) Linking.openURL(`tel:${phone}`).catch(() => {});
  };

  const hasCoords =
    typeof order.martLatitude === "number" &&
    typeof order.martLongitude === "number";

  const openRestaurantMaps = () => {
    const query = hasCoords
      ? `${order.martLatitude},${order.martLongitude}`
      : [order.restaurantName, order.martAddress].filter(Boolean).join(" ");
    if (!query) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      query,
    )}`;
    Linking.openURL(url).catch(() => {});
  };

  const canNavigate = hasCoords || !!order.martAddress || !!order.restaurantName;

  const hasCustomerCoords =
    typeof order.latitude === "number" &&
    typeof order.longitude === "number";

  const openCustomerMaps = () => {
    const query = hasCustomerCoords
      ? `${order.latitude},${order.longitude}`
      : [order.userName, order.address].filter(Boolean).join(" ");
    if (!query) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      query,
    )}`;
    Linking.openURL(url).catch(() => {});
  };

  const canNavigateCustomer = hasCustomerCoords || !!order.address;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <View
          style={{
            paddingTop: topPad,
            paddingHorizontal: 20,
            paddingBottom: 12,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottomWidth: 1,
            borderBottomColor: c.border,
            backgroundColor: c.card,
          }}
        >
          <View>
            <Text
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 20,
                color: c.foreground,
              }}
            >
              Order details
            </Text>
            {order.orderNum ? (
              <Text
                style={{
                  fontFamily: "Inter_400Regular",
                  fontSize: 13,
                  color: c.mutedForeground,
                }}
              >
                #{order.orderNum}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={handleClose}
            hitSlop={10}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: c.muted,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Feather name="x" size={20} color={c.foreground} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 14,
            paddingBottom: insets.bottom + 32,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Badge label={statusLabel(order.status)} bg={sc.bg} fg={sc.fg} />
            {order.paidToRider ? (
              <Badge label="Paid out" bg={c.successBg} fg={c.successForeground} />
            ) : null}
          </View>

          <Section title="Restaurant / Mart">
            <Text
              style={{
                fontFamily: "Inter_600SemiBold",
                fontSize: 16,
                color: c.foreground,
              }}
            >
              {order.restaurantName || "—"}
            </Text>
            {order.martAddress ? (
              <Text
                style={{
                  fontFamily: "Inter_400Regular",
                  fontSize: 13,
                  color: c.mutedForeground,
                  marginTop: 4,
                }}
              >
                {order.martAddress}
              </Text>
            ) : null}
            {order.martPhone ? (
              <Pressable
                onPress={() => callPhone(order.martPhone)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 8,
                }}
              >
                <Feather name="phone" size={14} color={c.primary} />
                <Text
                  style={{
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 13,
                    color: c.primary,
                  }}
                >
                  {order.martPhone}
                </Text>
              </Pressable>
            ) : null}
            {canNavigate ? (
              <Pressable
                onPress={openRestaurantMaps}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  marginTop: 12,
                  alignSelf: "flex-start",
                  backgroundColor: c.primary,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 10,
                }}
              >
                <Feather
                  name="navigation"
                  size={15}
                  color={c.primaryForeground}
                />
                <Text
                  style={{
                    fontFamily: "Inter_700Bold",
                    fontSize: 13,
                    color: c.primaryForeground,
                  }}
                >
                  Open in Google Maps
                </Text>
              </Pressable>
            ) : null}
          </Section>

          <Section title="Customer">
            <Text
              style={{
                fontFamily: "Inter_600SemiBold",
                fontSize: 16,
                color: c.foreground,
              }}
            >
              {order.userName || "—"}
            </Text>
            {order.address ? (
              <Text
                style={{
                  fontFamily: "Inter_400Regular",
                  fontSize: 13,
                  color: c.mutedForeground,
                  marginTop: 4,
                }}
              >
                {order.address}
              </Text>
            ) : null}
            {order.zone || order.distance ? (
              <Text
                style={{
                  fontFamily: "Inter_400Regular",
                  fontSize: 12,
                  color: c.mutedForeground,
                  marginTop: 4,
                }}
              >
                {[order.zone, order.distance].filter(Boolean).join(" · ")}
              </Text>
            ) : null}
            {order.phone ? (
              <Pressable
                onPress={() => callPhone(order.phone)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 8,
                }}
              >
                <Feather name="phone" size={14} color={c.primary} />
                <Text
                  style={{
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 13,
                    color: c.primary,
                  }}
                >
                  {order.phone}
                </Text>
              </Pressable>
            ) : null}
            {canNavigateCustomer ? (
              <Pressable
                onPress={openCustomerMaps}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  marginTop: 12,
                  alignSelf: "flex-start",
                  backgroundColor: c.primary,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 10,
                }}
              >
                <Feather
                  name="navigation"
                  size={15}
                  color={c.primaryForeground}
                />
                <Text
                  style={{
                    fontFamily: "Inter_700Bold",
                    fontSize: 13,
                    color: c.primaryForeground,
                  }}
                >
                  Open in Google Maps
                </Text>
              </Pressable>
            ) : null}
          </Section>

          {order.comment ? (
            <Section title="Order notes">
              <View
                style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}
              >
                <Feather
                  name="message-square"
                  size={16}
                  color={c.warning}
                  style={{ marginTop: 1 }}
                />
                <Text
                  style={{
                    flex: 1,
                    fontFamily: "Inter_500Medium",
                    fontSize: 14,
                    lineHeight: 20,
                    color: c.foreground,
                  }}
                >
                  {order.comment}
                </Text>
              </View>
            </Section>
          ) : null}

          {order.items && order.items.length > 0 ? (
            <Section title={`Items (${order.items.length})`}>
              {order.items.map((item, idx) => {
                const { baseName, selections } = parseItemName(item.name);
                const isDeal =
                  item.type === "deal" &&
                  Array.isArray(item.dealItems) &&
                  item.dealItems.length > 0;
                return (
                  <Pressable
                    key={idx}
                    onPress={isDeal ? () => setDealItem(item) : undefined}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      paddingVertical: 8,
                      borderTopWidth: idx === 0 ? 0 : 1,
                      borderTopColor: c.border,
                    }}
                  >
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: "Inter_600SemiBold",
                            fontSize: 14,
                            color: c.foreground,
                          }}
                        >
                          {item.quantity}× {baseName}
                          {item.size ? ` (${item.size})` : ""}
                        </Text>
                        {isDeal ? (
                          <Badge
                            label="Deal"
                            bg={c.primary}
                            fg={c.primaryForeground}
                          />
                        ) : null}
                      </View>
                      {selections.map((sel, i) => (
                        <Text
                          key={i}
                          style={{
                            fontFamily: "Inter_400Regular",
                            fontSize: 12,
                            color: c.mutedForeground,
                            marginTop: 2,
                          }}
                        >
                          • {sel}
                        </Text>
                      ))}
                      {isDeal ? (
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 2,
                            marginTop: 4,
                          }}
                        >
                          <Text
                            style={{
                              fontFamily: "Inter_600SemiBold",
                              fontSize: 12,
                              color: c.primary,
                            }}
                          >
                            View what&apos;s included
                          </Text>
                          <Feather
                            name="chevron-right"
                            size={14}
                            color={c.primary}
                          />
                        </View>
                      ) : null}
                    </View>
                    <Text
                      style={{
                        fontFamily: "Inter_500Medium",
                        fontSize: 13,
                        color: c.foreground,
                      }}
                    >
                      {money(item.price)}
                    </Text>
                  </Pressable>
                );
              })}
            </Section>
          ) : null}

          <Section title="Payment">
            <Row label="Subtotal" value={money(order.subtotal)} />
            <Row label="Delivery fee" value={money(order.deliveryFee)} />
            {order.platformFee ? (
              <Row label="Platform fee" value={money(order.platformFee)} />
            ) : null}
            {order.discount ? (
              <Row
                label="Discount"
                value={`- ${money(order.discount)}`}
                color={c.success}
              />
            ) : null}
            {order.tip ? <Row label="Tip" value={money(order.tip)} /> : null}
            <View
              style={{
                height: 1,
                backgroundColor: c.border,
                marginVertical: 6,
              }}
            />
            <Row label="Order total" value={money(order.total)} strong />
            <Row
              label="Your fare"
              value={money(order.riderFare)}
              strong
              color={c.success}
            />
            <View
              style={{
                marginTop: 10,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                backgroundColor: cod ? c.warningBg : c.muted,
                paddingHorizontal: 10,
                paddingVertical: 8,
                borderRadius: 10,
              }}
            >
              <Feather
                name={cod ? "dollar-sign" : "credit-card"}
                size={14}
                color={cod ? c.warning : c.mutedForeground}
              />
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 12,
                  color: cod ? c.warning : c.mutedForeground,
                }}
              >
                {cod
                  ? "Collect cash on delivery"
                  : order.paymentType || "Paid online"}
              </Text>
            </View>
          </Section>

          {order.actions && order.actions.length > 0 ? (
            <Section title="Timeline">
              {order.actions.map((a, idx) => (
                <View
                  key={idx}
                  style={{
                    flexDirection: "row",
                    gap: 10,
                    paddingVertical: 6,
                  }}
                >
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: c.primary,
                      marginTop: 5,
                    }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontFamily: "Inter_500Medium",
                        fontSize: 13,
                        color: c.foreground,
                      }}
                    >
                      {a.action || "Update"}
                      {a.name ? ` · ${a.name}` : ""}
                    </Text>
                    {a.time ? (
                      <Text
                        style={{
                          fontFamily: "Inter_400Regular",
                          fontSize: 11,
                          color: c.mutedForeground,
                        }}
                      >
                        {a.time}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </Section>
          ) : null}
        </ScrollView>
      </View>

      <Modal
        visible={!!dealItem}
        transparent
        animationType="fade"
        onRequestClose={() => setDealItem(null)}
      >
        <Pressable
          onPress={() => setDealItem(null)}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.5)",
            justifyContent: "flex-end",
          }}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{
              backgroundColor: c.background,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingHorizontal: 20,
              paddingTop: 18,
              paddingBottom: insets.bottom + 20,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                justifyContent: "space-between",
                marginBottom: 4,
              }}
            >
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Badge
                  label="Deal"
                  bg={c.primary}
                  fg={c.primaryForeground}
                />
                <Text
                  style={{
                    fontFamily: "Inter_700Bold",
                    fontSize: 18,
                    color: c.foreground,
                    marginTop: 8,
                  }}
                >
                  {dealItem ? parseItemName(dealItem.name).baseName : ""}
                </Text>
                <Text
                  style={{
                    fontFamily: "Inter_400Regular",
                    fontSize: 13,
                    color: c.mutedForeground,
                    marginTop: 2,
                  }}
                >
                  What&apos;s included
                </Text>
              </View>
              <Pressable
                onPress={() => setDealItem(null)}
                hitSlop={10}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: c.muted,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Feather name="x" size={18} color={c.foreground} />
              </Pressable>
            </View>

            <View
              style={{
                marginTop: 12,
                backgroundColor: c.card,
                borderRadius: c.radius,
                borderWidth: 1,
                borderColor: c.border,
                paddingHorizontal: 14,
              }}
            >
              {(dealItem?.dealItems ?? []).map((d, i) => (
                <View
                  key={i}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingVertical: 12,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: c.border,
                  }}
                >
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    {d.title ? (
                      <Text
                        style={{
                          fontFamily: "Inter_400Regular",
                          fontSize: 11,
                          letterSpacing: 0.3,
                          textTransform: "uppercase",
                          color: c.mutedForeground,
                          marginBottom: 2,
                        }}
                      >
                        {d.title}
                      </Text>
                    ) : null}
                    <Text
                      style={{
                        fontFamily: "Inter_600SemiBold",
                        fontSize: 15,
                        color: c.foreground,
                      }}
                    >
                      {d.option || "—"}
                    </Text>
                  </View>
                  {d.price ? (
                    <Text
                      style={{
                        fontFamily: "Inter_600SemiBold",
                        fontSize: 13,
                        color: c.mutedForeground,
                      }}
                    >
                      + {money(d.price)}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Modal>
  );
}
