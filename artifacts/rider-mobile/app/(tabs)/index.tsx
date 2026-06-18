import { Feather } from "@expo/vector-icons";
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
import React, { useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  Switch,
  Text,
  View,
} from "react-native";

import { OrderCard } from "@/components/OrderCard";
import { OrderDetailModal } from "@/components/OrderDetailModal";
import { Button, EmptyState, Loading, ScreenHeader } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useOrderAlert } from "@/lib/alert";

export default function AvailableScreen() {
  const c = useColors();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<RiderOrder | null>(null);

  const meQ = useGetRiderMe();
  const isOnline = !!meQ.data?.isOnline;

  const ordersQ = useGetAvailableOrders({
    query: {
      queryKey: getGetAvailableOrdersQueryKey(),
      enabled: isOnline,
      refetchInterval: isOnline ? 10000 : false,
    },
  });
  const orders = ordersQ.data ?? [];

  const { newCount, clearNew } = useOrderAlert(orders, isOnline);

  const availabilityM = useUpdateRiderAvailability();
  const acceptM = useAcceptOrder();

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

  const accept = (order: RiderOrder) => {
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

  const onlineSwitch = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text
        style={{
          fontFamily: "Inter_600SemiBold",
          fontSize: 13,
          color: isOnline ? c.success : c.mutedForeground,
        }}
      >
        {isOnline ? "Online" : "Offline"}
      </Text>
      <Switch
        value={isOnline}
        onValueChange={toggleOnline}
        disabled={availabilityM.isPending}
        trackColor={{ false: c.input, true: c.success }}
        thumbColor="#FFFFFF"
      />
    </View>
  );

  if (meQ.isLoading) return <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader
        title="Available"
        subtitle={
          isOnline ? "Waiting for new orders" : "Go online to see orders"
        }
        right={onlineSwitch}
      />

      {newCount > 0 ? (
        <Pressable
          onPress={clearNew}
          style={{
            marginHorizontal: 20,
            marginBottom: 8,
            backgroundColor: c.primary,
            borderRadius: c.radius,
            padding: 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Feather name="bell" size={18} color="#FFFFFF" />
          <Text
            style={{
              flex: 1,
              fontFamily: "Inter_600SemiBold",
              fontSize: 14,
              color: "#FFFFFF",
            }}
          >
            {newCount} new order
            {newCount === 1 ? "" : "s"} just arrived!
          </Text>
          <Feather name="x" size={18} color="#FFFFFF" />
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
              <Feather name="power" size={28} color={c.mutedForeground} />
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
