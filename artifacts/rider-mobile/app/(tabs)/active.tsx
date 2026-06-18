import {
  getGetActiveOrdersQueryKey,
  getGetOrderHistoryQueryKey,
  getGetRiderEarningsQueryKey,
  getGetRiderMeQueryKey,
  useGetActiveOrders,
  useMarkOrderArrived,
  useUpdateOrderStatus,
  type RiderOrder,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  Text,
  View,
} from "react-native";

import { OrderCard } from "@/components/OrderCard";
import { OrderDetailModal } from "@/components/OrderDetailModal";
import { Button, EmptyState, ScreenHeader } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import {
  ensureLocationPermission,
  useLocationTracking,
} from "@/lib/useLocationTracking";

export default function ActiveScreen() {
  const c = useColors();
  const qc = useQueryClient();
  const { token } = useAuth();
  const [selected, setSelected] = useState<RiderOrder | null>(null);

  const ordersQ = useGetActiveOrders({
    query: {
      queryKey: getGetActiveOrdersQueryKey(),
      enabled: !!token,
      refetchInterval: 10000,
    },
  });
  const orders = ordersQ.data ?? [];

  const trackId =
    orders.find((o) => o.status === "Rider Picked Up")?.id ?? null;
  useLocationTracking(trackId);

  const statusM = useUpdateOrderStatus();
  const arrivedM = useMarkOrderArrived();

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: getGetActiveOrdersQueryKey() });
    qc.invalidateQueries({ queryKey: getGetRiderEarningsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetRiderMeQueryKey() });
    qc.invalidateQueries({ queryKey: getGetOrderHistoryQueryKey() });
  };

  const onMutated = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );
    invalidateAll();
  };

  const setStatus = (order: RiderOrder, status: string) => {
    statusM.mutate(
      { orderId: order.id, data: { status } },
      { onSuccess: onMutated },
    );
  };

  const markArrived = (order: RiderOrder) => {
    arrivedM.mutate({ orderId: order.id }, { onSuccess: onMutated });
  };

  const pickUp = async (order: RiderOrder) => {
    // Force live-location sharing: a delivery cannot start until the rider grants
    // location access, so the customer can always track the order in transit.
    const granted = await ensureLocationPermission();
    if (!granted) {
      Alert.alert(
        "Location required",
        "Enable location sharing so the customer can track their delivery. Please allow location access to continue.",
      );
      return;
    }
    setStatus(order, "Rider Picked Up");
  };

  const deliver = (order: RiderOrder) => {
    Alert.alert(
      "Deliver order?",
      "Confirm you have handed the order to the customer.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Deliver",
          style: "default",
          onPress: () => setStatus(order, "Delivered"),
        },
      ],
    );
  };

  const renderAction = (order: RiderOrder) => {
    const statusBusy =
      statusM.isPending && statusM.variables?.orderId === order.id;
    const arrivedBusy =
      arrivedM.isPending && arrivedM.variables?.orderId === order.id;

    // Progression: Rider Accepted -> (Arrived at Restaurant) -> Rider Picked Up -> Delivered.
    if (order.status === "Rider Picked Up") {
      return (
        <Button
          label="Mark as delivered"
          icon="check-circle"
          variant="success"
          loading={statusBusy}
          onPress={() => deliver(order)}
          style={{ alignSelf: "stretch" }}
        />
      );
    }
    if (order.status === "Rider Accepted" && !order.riderArrived) {
      return (
        <Button
          label="Arrived at restaurant"
          icon="map-pin"
          variant="info"
          loading={arrivedBusy}
          onPress={() => markArrived(order)}
          style={{ alignSelf: "stretch" }}
        />
      );
    }
    return (
      <Button
        label="Picked up"
        icon="shopping-bag"
        loading={statusBusy}
        onPress={() => pickUp(order)}
        style={{ alignSelf: "stretch" }}
      />
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader
        title="Active"
        subtitle={
          orders.length > 0
            ? `${orders.length} delivery in progress`
            : "No active deliveries"
        }
      />

      {trackId ? (
        <View
          style={{
            marginHorizontal: 20,
            marginBottom: 8,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            backgroundColor: c.successBg,
            borderRadius: c.radius,
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: c.success,
            }}
          />
          <Text
            style={{
              fontFamily: "Inter_500Medium",
              fontSize: 12,
              color: c.successForeground,
            }}
          >
            Sharing live location with the customer
          </Text>
        </View>
      ) : null}

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
            {renderAction(item)}
          </OrderCard>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="navigation"
            title="No active deliveries"
            subtitle="Accept an order from the Available tab."
          />
        }
      />

      <OrderDetailModal
        order={selected}
        visible={!!selected}
        onClose={() => setSelected(null)}
      />
    </View>
  );
}
