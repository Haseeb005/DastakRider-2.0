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
import React, { useEffect, useReducer, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
  Text,
  View,
} from "react-native";

import { ChatBadgeButton } from "@/components/ChatBadgeButton";
import { OrderCard } from "@/components/OrderCard";
import { OrderDetailModal } from "@/components/OrderDetailModal";
import { Button, EmptyState, ScreenHeader } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import {
  ensureLocationPermission,
  needsBackgroundLocationPermission,
  requestBackgroundLocationPermissionAfterDisclosure,
} from "@/lib/useLocationTracking";
import {
  getLocationStatus,
  getTrackCount,
  subscribe as subscribeLocationStore,
} from "@/lib/locationShareStore";
import { useChatWatcher } from "@/lib/useChatWatcher";

export default function ActiveScreen() {
  const c = useColors();
  const qc = useQueryClient();
  const router = useRouter();
  const { token } = useAuth();
  const [selected, setSelected] = useState<RiderOrder | null>(null);
  const [pickupAwaitingConsent, setPickupAwaitingConsent] =
    useState<RiderOrder | null>(null);
  const [requestingLocation, setRequestingLocation] = useState(false);
  // Snapshot of unread message IDs seen when the rider last opened each order's
  // chat.  The card badge shows only messages NOT in this snapshot, so:
  //   • it clears immediately when the chat screen is opened (optimistic UX)
  //   • it reappears if a NEW unread message arrives after the rider closes chat
  const [seenUnreadIds, setSeenUnreadIds] = useState<
    Record<string, Set<string>>
  >({});
  const ordersQ = useGetActiveOrders({
    query: {
      queryKey: getGetActiveOrdersQueryKey(),
      enabled: !!token,
      refetchInterval: 10000,
    },
  });
  const orders = ordersQ.data ?? [];
  const orderIds = orders.map((o) => o.id);

  // Background chat watcher — keeps message counts fresh for the card-level badge.
  // Banner + push notifications are handled at the tab-layout level (_layout.tsx)
  // so they work on every tab, not just when this screen is mounted.
  const { messagesByOrderId } = useChatWatcher(orderIds);

  // Returns the number of customer messages that arrived AFTER the rider last
  // opened the chat for this order — used for the OrderCard corner badge.
  const unreadCount = (orderId: string): number => {
    const seen = seenUnreadIds[orderId] ?? new Set<string>();
    return (messagesByOrderId[orderId] ?? []).filter(
      (m) => m.fromRole === "customer" && !m.read && !seen.has(m.id),
    ).length;
  };

  // Location tracking is lifted to _layout.tsx (always mounted) so it
  // survives tab switches. Subscribe to the store for the status banner.
  const [, rerenderLocation] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeLocationStore(rerenderLocation), []);
  const locationStatus = getLocationStatus();
  const trackCount = getTrackCount();

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

  const completePickup = async (order: RiderOrder, requestBackground: boolean) => {
    // Foreground location is required before a delivery begins.
    const granted = await ensureLocationPermission();
    if (!granted) {
      Alert.alert(
        "Location required",
        "Enable location sharing so the customer can track their delivery. Please allow location access to continue.",
      );
      return;
    }
    if (requestBackground) {
      // The rider just accepted the dedicated prominent disclosure modal.
      // This immediately opens Android's background-location permission screen.
      await requestBackgroundLocationPermissionAfterDisclosure();
    }
    setStatus(order, "Rider Picked Up");
  };

  const pickUp = async (order: RiderOrder) => {
    // The prominent disclosure must be shown immediately before any possible
    // background-location permission request. Do not use an Alert for this:
    // Play reviewers need a clear, in-app consent screen with an affirmative CTA.
    if (Platform.OS !== "web" && await needsBackgroundLocationPermission()) {
      setPickupAwaitingConsent(order);
      return;
    }
    await completePickup(order, false);
  };

  const continueWithBackgroundLocation = async () => {
    const order = pickupAwaitingConsent;
    if (!order) return;
    setRequestingLocation(true);
    try {
      await completePickup(order, true);
      setPickupAwaitingConsent(null);
    } finally {
      setRequestingLocation(false);
    }
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

      {trackCount > 0 ? (
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

      <Modal
        animationType="slide"
        transparent
        visible={!!pickupAwaitingConsent}
        onRequestClose={() => {
          if (!requestingLocation) setPickupAwaitingConsent(null);
        }}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "flex-end",
            backgroundColor: "rgba(17, 24, 39, 0.58)",
          }}
        >
          <View
            style={{
              backgroundColor: c.card,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              paddingHorizontal: 24,
              paddingTop: 28,
              paddingBottom: 36,
              gap: 16,
            }}
          >
            <View
              style={{
                alignSelf: "flex-start",
                backgroundColor: c.secondary,
                borderRadius: 999,
                paddingHorizontal: 12,
                paddingVertical: 6,
              }}
            >
              <Text
                style={{
                  color: c.primary,
                  fontFamily: "Inter_700Bold",
                  fontSize: 12,
                }}
              >
                LOCATION SHARING DURING DELIVERY
              </Text>
            </View>
            <Text
              style={{
                color: c.foreground,
                fontFamily: "Inter_700Bold",
                fontSize: 24,
                lineHeight: 31,
              }}
            >
              Allow background location?
            </Text>
            <Text
              style={{
                color: c.mutedForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 15,
                lineHeight: 23,
              }}
            >
              Dastak Rider collects and shares your precise location with the
              customer while you are completing an active delivery, including
              when the app is closed or not in use. This lets the customer
              track the delivery in real time while you use navigation or
              switch apps.
            </Text>
            <Text
              style={{
                color: c.mutedForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 13,
                lineHeight: 20,
              }}
            >
              Location sharing stops automatically after the delivery is marked
              as delivered.
            </Text>
            <Button
              label="Continue and allow location"
              icon="navigation"
              loading={requestingLocation}
              onPress={continueWithBackgroundLocation}
              style={{ alignSelf: "stretch", marginTop: 4 }}
            />
            <Button
              label="Not now"
              variant="outline"
              disabled={requestingLocation}
              onPress={() => setPickupAwaitingConsent(null)}
              style={{ alignSelf: "stretch" }}
            />
          </View>
        </View>
      </Modal>

    </View>
  );
}
