import { Icon } from "@/components/Icon";
import {
  getGetActiveOrdersQueryKey,
  getGetAvailableOrdersQueryKey,
  getGetRiderMeQueryKey,
  useAcceptOrder,
  useGetAvailableOrders,
  useGetRiderMe,
  useUpdateRiderAvailability,
  type RiderOrder,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OrderCard } from "@/components/OrderCard";
import { OrderDetailModal } from "@/components/OrderDetailModal";
import { Button, EmptyState, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useOrderAlert } from "@/lib/alert";

const EMPTY_ORDERS: RiderOrder[] = [];

function StatusDot({
  online,
  dotColor,
  offColor,
}: {
  online: boolean;
  dotColor: string;
  offColor: string;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!online) {
      pulse.setValue(0);
      return;
    }
    const anim = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [online, pulse]);

  return (
    <View
      style={{
        width: 14,
        height: 14,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {online ? (
        <Animated.View
          style={{
            position: "absolute",
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: dotColor,
            opacity: pulse.interpolate({
              inputRange: [0, 1],
              outputRange: [0.5, 0],
            }),
            transform: [
              {
                scale: pulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 2.2],
                }),
              },
            ],
          }}
        />
      ) : null}
      <View
        style={{
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: online ? dotColor : offColor,
        }}
      />
    </View>
  );
}

export default function AvailableScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<RiderOrder | null>(null);

  const meQ = useGetRiderMe();
  const isOnline = !!meQ.data?.isOnline;
  const canGoOnline = meQ.data?.available !== false;

  const ordersQ = useGetAvailableOrders({
    query: {
      queryKey: getGetAvailableOrdersQueryKey(),
      enabled: isOnline && canGoOnline,
      refetchInterval: isOnline && canGoOnline ? 10000 : false,
    },
  });
  const orders = ordersQ.data ?? EMPTY_ORDERS;

  const { newCount, clearNew } = useOrderAlert(orders, isOnline);

  const availabilityM = useUpdateRiderAvailability();
  const acceptM = useAcceptOrder();

  const toggleOnline = () => {
    if (!isOnline && !canGoOnline) return; // blocked by admin, can't go online
    Haptics.selectionAsync().catch(() => {});
    availabilityM.mutate(
      { data: { isOnline: !isOnline } },
      {
        onSuccess: () =>
          qc.invalidateQueries({ queryKey: getGetRiderMeQueryKey() }),
      },
    );
  };

  const accept = (order: RiderOrder) => {
    // Accepting within the alert window must silence the beep and hide the
    // new-order banner immediately.
    clearNew();
    acceptM.mutate(
      { orderId: order.id },
      {
        onSuccess: () => {
          Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success,
          ).catch(() => {});
          qc.invalidateQueries({ queryKey: getGetAvailableOrdersQueryKey() });
          qc.invalidateQueries({ queryKey: getGetActiveOrdersQueryKey() });
        },
      },
    );
  };

  const refresh = () => {
    Haptics.selectionAsync().catch(() => {});
    meQ.refetch();
    ordersQ.refetch();
  };

  if (meQ.isLoading) return <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View
        style={{
          backgroundColor: c.card,
          paddingTop: Platform.OS === "web" ? 24 : insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: 16,
          borderBottomLeftRadius: 24,
          borderBottomRightRadius: 24,
          shadowColor: "#000",
          shadowOpacity: 0.05,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 3,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <View style={{ flex: 1, paddingRight: 12 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                marginBottom: 2,
              }}
            >
              <Icon name="bike" size={15} color={c.primary} />
              <Text
                style={{
                  fontFamily: "Inter_800ExtraBold",
                  fontSize: 12,
                  letterSpacing: 1,
                  color: c.primary,
                  textTransform: "uppercase",
                }}
              >
                Dastak Rider
              </Text>
            </View>
            <Text
              numberOfLines={1}
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 22,
                color: c.foreground,
              }}
            >
              {meQ.data?.name ?? "Rider"}
            </Text>
          </View>
          <Pressable
            onPress={refresh}
            hitSlop={8}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: c.muted,
              alignItems: "center",
              justifyContent: "center",
            }}
            accessibilityLabel="Refresh orders"
          >
            <Icon name="refresh-cw" size={18} color={c.foreground} />
          </Pressable>
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: c.background,
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderWidth: 1,
            borderColor: c.border,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <StatusDot online={isOnline} dotColor={c.success} offColor={c.mutedForeground} />
            <View>
              <Text
                style={{
                  fontFamily: "Inter_700Bold",
                  fontSize: 16,
                  color: isOnline ? c.success : c.mutedForeground,
                }}
              >
                {isOnline ? "You are Online" : "You are Offline"}
              </Text>
              {!canGoOnline && (
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: c.destructive }}>
                  Not available — contact admin
                </Text>
              )}
            </View>
          </View>
          <Pressable
            onPress={() => {
              if (!availabilityM.isPending) toggleOnline();
            }}
            disabled={availabilityM.isPending || (!isOnline && !canGoOnline)}
            accessibilityRole="switch"
            accessibilityState={{ checked: isOnline, disabled: availabilityM.isPending || (!isOnline && !canGoOnline) }}
            accessibilityLabel={isOnline ? "Go offline" : "Go online"}
            style={{
              width: 52,
              height: 30,
              borderRadius: 15,
              backgroundColor: isOnline ? c.success : c.input,
              padding: 3,
              flexDirection: "row",
              justifyContent: isOnline ? "flex-end" : "flex-start",
              alignItems: "center",
              opacity: (availabilityM.isPending || (!isOnline && !canGoOnline)) ? 0.4 : 1,
            }}
          >
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: "#FFFFFF",
                shadowColor: "#000",
                shadowOpacity: 0.2,
                shadowRadius: 2,
                shadowOffset: { width: 0, height: 1 },
                elevation: 2,
              }}
            />
          </Pressable>
        </View>
      </View>

      {newCount > 0 ? (
        <Pressable
          onPress={clearNew}
          style={{
            marginHorizontal: 20,
            marginTop: 16,
            marginBottom: 4,
            backgroundColor: c.primary,
            borderRadius: 20,
            padding: 14,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <View
            style={{
              backgroundColor: "rgba(255,255,255,0.2)",
              padding: 8,
              borderRadius: 12,
            }}
          >
            <Icon name="bell" size={20} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: "Inter_800ExtraBold",
                fontSize: 16,
                color: "#FFFFFF",
              }}
            >
              {newCount} new order{newCount === 1 ? "" : "s"} arrived!
            </Text>
            <Text
              style={{
                fontFamily: "Inter_500Medium",
                fontSize: 13,
                color: "rgba(255,255,255,0.9)",
                marginTop: 1,
              }}
            >
              Tap accept quickly to secure them.
            </Text>
          </View>
          <Icon name="x" size={20} color="rgba(255,255,255,0.85)" />
        </Pressable>
      ) : null}

      {!isOnline ? (
        <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24 }}>
          <View
            style={{
              backgroundColor: c.card,
              borderRadius: c.radius,
              borderWidth: 1,
              borderColor: c.border,
              padding: 24,
              alignItems: "center",
              gap: 14,
            }}
          >
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: c.muted,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="power" size={28} color={c.mutedForeground} />
            </View>
            <Text
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 18,
                color: c.foreground,
                textAlign: "center",
              }}
            >
              You are currently offline
            </Text>
            <Text
              style={{
                fontFamily: "Inter_400Regular",
                fontSize: 14,
                color: c.mutedForeground,
                textAlign: "center",
                lineHeight: 20,
              }}
            >
              Go online to start receiving orders.
            </Text>
            <Button
              label="Go online"
              icon="power"
              variant="success"
              loading={availabilityM.isPending}
              onPress={toggleOnline}
              style={{ alignSelf: "stretch", marginTop: 4 }}
            />
          </View>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 4,
            paddingBottom: Platform.OS === "web" ? 120 : 110,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={ordersQ.isRefetching}
              onRefresh={() => ordersQ.refetch()}
              tintColor={c.primary}
            />
          }
          ListHeaderComponent={
            orders.length > 0 ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 12,
                  paddingHorizontal: 2,
                }}
              >
                <Text
                  style={{
                    fontFamily: "Inter_700Bold",
                    fontSize: 18,
                    color: c.foreground,
                  }}
                >
                  Available Orders
                </Text>
                <View
                  style={{
                    backgroundColor: c.primary,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 999,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "Inter_700Bold",
                      fontSize: 11,
                      letterSpacing: 0.5,
                      color: "#FFFFFF",
                    }}
                  >
                    LIVE
                  </Text>
                </View>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <OrderCard order={item} onPress={() => setSelected(item)}>
              <Button
                label="Accept order"
                icon="check"
                onPress={() => accept(item)}
                loading={acceptM.isPending && acceptM.variables?.orderId === item.id}
                style={{ alignSelf: "stretch" }}
              />
            </OrderCard>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="inbox"
              title="No available orders"
              subtitle="New orders will appear here instantly."
            />
          }
        />
      )}

      <OrderDetailModal
        order={selected}
        visible={!!selected}
        onClose={() => setSelected(null)}
      />
    </View>
  );
}
