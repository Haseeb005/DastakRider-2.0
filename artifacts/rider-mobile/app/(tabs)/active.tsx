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
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  Text,
  View,
} from "react-native";

import { ChatBadgeButton } from "@/components/ChatBadgeButton";
import { ChatBanner, type BannerInfo } from "@/components/ChatBanner";
import { OrderCard } from "@/components/OrderCard";
import { OrderDetailModal } from "@/components/OrderDetailModal";
import { Button, EmptyState, ScreenHeader } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import {
  ensureLocationPermission,
  useLocationTracking,
} from "@/lib/useLocationTracking";
import { useChatWatcher } from "@/lib/useChatWatcher";

export default function ActiveScreen() {
  const c = useColors();
  const qc = useQueryClient();
  const router = useRouter();
  const { token } = useAuth();
  const [selected, setSelected] = useState<RiderOrder | null>(null);
  // Snapshot of unread message IDs seen when the rider last opened each order's
  // chat.  The card badge shows only messages NOT in this snapshot, so:
  //   • it clears immediately when the chat screen is opened (optimistic UX)
  //   • it reappears if a NEW unread message arrives after the rider closes chat
  const [seenUnreadIds, setSeenUnreadIds] = useState<
    Record<string, Set<string>>
  >({});
  const [banner, setBanner] = useState<BannerInfo | null>(null);

  const ordersQ = useGetActiveOrders({
    query: {
      queryKey: getGetActiveOrdersQueryKey(),
      enabled: !!token,
      refetchInterval: 10000,
    },
  });
  const orders = ordersQ.data ?? [];
  const orderIds = orders.map((o) => o.id);

  // Stable ref so the callback never re-triggers the watcher subscription.
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const onNewMessage = useCallback((orderId: string) => {
    const order = ordersRef.current.find((o: { id: string; userName?: string | null; orderNum?: string | number | null }) => o.id === orderId);
    setBanner({
      orderId,
      customerName: order?.userName ?? undefined,
      orderNum: order?.orderNum ? String(order.orderNum) : undefined,
    });
  }, []);

  // Background chat watcher — keeps message counts fresh for the card-level badge.
  const { messagesByOrderId } = useChatWatcher(orderIds, onNewMessage);

  // Returns the number of customer messages that arrived AFTER the rider last
  // opened the chat for this order — used for the OrderCard corner badge.
  const unreadCount = (orderId: string): number => {
    const seen = seenUnreadIds[orderId] ?? new Set<string>();
    return (messagesByOrderId[orderId] ?? []).filter(
      (m) => m.fromRole === "customer" && !m.read && !seen.has(m.id),
    ).length;
  };

  // Track ALL "Rider Picked Up" orders concurrently (fix: was only tracking first one).
  const trackIds = orders
    .filter((o) => o.status === "Rider Picked Up")
    .map((o) => o.id);
  const locationStatus = useLocationTracking(trackIds);

  // Alert the rider the moment live sharing drops mid-delivery.
  useEffect(() => {
    if (locationStatus === "error") {
      Alert.alert(
        "Live location sharing stopped",
        "The customer can't track your delivery. Re-enable location access to keep sharing.",
      );
    }
  }, [locationStatus]);

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

  const onMutateError = (e: any) => {
    Alert.alert(
      "Update failed",
      e?.data?.message || "Could not update order status. Please try again.",
    );
  };

  const setStatus = (order: RiderOrder, status: string) => {
    statusM.mutate(
      { orderId: order.id, data: { status } },
      { onSuccess: onMutated, onError: onMutateError },
    );
  };

  const markArrived = (order: RiderOrder) => {
    arrivedM.mutate(
      { orderId: order.id },
      { onSuccess: onMutated, onError: onMutateError },
    );
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
    setStatus(order, "Delivered");
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

      {trackIds.length > 0 ? (
        <View
          style={{
            marginHorizontal: 20,
            marginBottom: 8,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            backgroundColor:
              locationStatus === "error" ? c.warningBg : c.successBg,
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
              backgroundColor:
                locationStatus === "error" ? c.warning : c.success,
            }}
          />
          <Text
            style={{
              fontFamily: "Inter_500Medium",
              fontSize: 12,
              color: locationStatus === "error" ? c.warning : c.successForeground,
              flex: 1,
            }}
          >
            {locationStatus === "error"
              ? "Live location sharing stopped — re-enable location so the customer can track you"
              : "Sharing live location with the customer"}
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
          <OrderCard
            order={item}
            onPress={() => setSelected(item)}
            unreadCount={unreadCount(item.id)}
          >
            {renderAction(item)}
            <ChatBadgeButton
              orderId={item.id}
              customerName={item.userName ?? undefined}
              onPress={() => {
                // Snapshot current unread IDs so the card corner badge clears
                // immediately.  Any message arriving after this moment will
                // re-trigger the badge (not in the snapshot set).
                const currentUnread = new Set(
                  (messagesByOrderId[item.id] ?? [])
                    .filter((m) => m.fromRole === "customer" && !m.read)
                    .map((m) => m.id),
                );
                setSeenUnreadIds((prev) => ({
                  ...prev,
                  [item.id]: currentUnread,
                }));
                router.push(`/chat/${item.id}?orderNum=${encodeURIComponent(item.orderNum ?? "")}&customerName=${encodeURIComponent(item.userName ?? "")}`);
              }}
            />
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

      {/* Slide-in banner when a customer message arrives */}
      <ChatBanner banner={banner} onDismiss={() => setBanner(null)} />
    </View>
  );
}
