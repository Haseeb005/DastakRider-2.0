import {
  getGetActiveOrdersQueryKey,
  getGetOrderHistoryQueryOptions,
  getGetOrderHistoryQueryKey,
  getGetRiderEarningsQueryKey,
  getGetRiderMeQueryKey,
  useGetActiveOrders,
  useGetRiderMe,
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
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";

import { ChatBadgeButton } from "@/components/ChatBadgeButton";
import { Icon } from "@/components/Icon";
import { OrderCard } from "@/components/OrderCard";
import { OrderCapacityStatus } from "@/components/OrderCapacityStatus";
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

function shouldRetryStatusMutation(failureCount: number, error: any): boolean {
  if (failureCount >= 2) return false;

  const status = Number(error?.status);
  if (!Number.isFinite(status)) return true;

  return status === 408 || status === 429 || status >= 500;
}

type DeliveryStop = {
  order: RiderOrder;
  kind: "pickup" | "dropoff";
  target: string;
};

function getDeliveryStopTarget(order: RiderOrder, kind: DeliveryStop["kind"]) {
  if (kind === "pickup") {
    return typeof order.martLatitude === "number" &&
      typeof order.martLongitude === "number"
      ? `${order.martLatitude},${order.martLongitude}`
      : [order.restaurantName, order.martAddress].filter(Boolean).join(" ");
  }
  return typeof order.latitude === "number" &&
    typeof order.longitude === "number"
    ? `${order.latitude},${order.longitude}`
    : order.address ?? "";
}

function getDeliveryStopSequence(orders: RiderOrder[]): DeliveryStop[] {
  const live = orders
    .filter(
      (order) =>
        order.status === "Rider Accepted" ||
        order.status === "Rider Picked Up",
    )
    .slice(0, 2);
  return [
    ...live
      .filter((order) => order.status === "Rider Accepted")
      .map((order) => ({
        order,
        kind: "pickup" as const,
        target: getDeliveryStopTarget(order, "pickup"),
      })),
    ...live
      .filter((order) => order.status === "Rider Picked Up")
      .map((order) => ({
        order,
        kind: "dropoff" as const,
        target: getDeliveryStopTarget(order, "dropoff"),
      })),
  ];
}

function DeliveryStopSequence({ orders }: { orders: RiderOrder[] }) {
  const c = useColors();
  const liveCount = orders.filter(
    (order) =>
      order.status === "Rider Accepted" ||
      order.status === "Rider Picked Up",
  ).length;
  if (liveCount < 2) return null;

  const stops = getDeliveryStopSequence(orders);
  return (
    <View
      accessibilityLabel="Suggested stop sequence. Pick up accepted orders before customer drop-offs."
      style={{
        marginHorizontal: 20,
        marginBottom: 12,
        padding: 14,
        borderRadius: c.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.card,
      }}
    >
      <Text
        style={{
          color: c.foreground,
          fontSize: 14,
          fontFamily: "Inter_700Bold",
        }}
      >
        Suggested stop sequence
      </Text>
      <Text
        style={{
          marginTop: 4,
          marginBottom: 10,
          color: c.mutedForeground,
          fontSize: 12,
          lineHeight: 17,
          fontFamily: "Inter_400Regular",
        }}
      >
        Pick up an accepted order before continuing; orders already picked up
        go to their customers.
      </Text>
      <View style={{ gap: 8 }}>
        {stops.map((stop, index) => {
          const isPickup = stop.kind === "pickup";
          const locationName = isPickup
            ? stop.order.restaurantName || "Restaurant pickup"
            : stop.order.userName
              ? `Deliver to ${stop.order.userName}`
              : "Customer drop-off";
          const orderLabel = stop.order.orderNum
            ? `Order #${stop.order.orderNum}`
            : `Order ${stop.order.id.slice(-6)}`;
          const instruction = isPickup
            ? stop.order.riderArrived
              ? "At restaurant — mark this order picked up before the next stop."
              : "Mark arrived, then pick up this order before the next stop."
            : "This order is picked up; continue to the customer.";

          return (
            <View
              key={`${stop.order.id}-${stop.kind}`}
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: 10,
                padding: 10,
                borderRadius: 14,
                backgroundColor: c.background,
              }}
            >
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: c.primary,
                }}
              >
                <Text
                  style={{
                    color: "#FFFFFF",
                    fontSize: 12,
                    fontFamily: "Inter_700Bold",
                  }}
                >
                  {index + 1}
                </Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  style={{
                    color: c.primary,
                    fontSize: 10,
                    letterSpacing: 0.5,
                    fontFamily: "Inter_700Bold",
                  }}
                >
                  {isPickup ? "PICKUP" : "CUSTOMER DROP-OFF"} · {orderLabel}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    marginTop: 2,
                    color: c.foreground,
                    fontSize: 14,
                    fontFamily: "Inter_600SemiBold",
                  }}
                >
                  {locationName}
                </Text>
                <Text
                  style={{
                    marginTop: 2,
                    color: c.mutedForeground,
                    fontSize: 11,
                    lineHeight: 16,
                    fontFamily: "Inter_400Regular",
                  }}
                >
                  {instruction}
                </Text>
                {stop.target ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Navigate to ${locationName}, ${orderLabel}`}
                    testID={`delivery-stop-navigate-${stop.order.id}`}
                    onPress={() =>
                      Linking.openURL(
                        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.target)}`,
                      ).catch(() =>
                        Alert.alert("Could not open maps", "Try again or open your maps app."),
                      )
                    }
                    style={{
                      minHeight: 38,
                      alignSelf: "flex-start",
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      marginTop: 8,
                      paddingHorizontal: 11,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: c.border,
                      backgroundColor: c.card,
                    }}
                  >
                    <Icon name="navigation" size={15} color={c.primary} />
                    <Text
                      style={{
                        color: c.primary,
                        fontSize: 12,
                        fontFamily: "Inter_600SemiBold",
                      }}
                    >
                      Navigate
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function ActiveScreen() {
  const c = useColors();
  const qc = useQueryClient();
  const router = useRouter();
  const { token } = useAuth();
  const riderQ = useGetRiderMe({
    query: {
      queryKey: getGetRiderMeQueryKey(),
      enabled: !!token,
    },
  });
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

  const statusM = useUpdateOrderStatus({
    mutation: {
      retry: shouldRetryStatusMutation,
      retryDelay: (attemptIndex) => Math.min(750 * 2 ** attemptIndex, 3000),
    },
  });
  const arrivedM = useMarkOrderArrived({
    mutation: {
      retry: shouldRetryStatusMutation,
      retryDelay: (attemptIndex) => Math.min(750 * 2 ** attemptIndex, 3000),
    },
  });

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
    const isNetworkError = !Number.isFinite(Number(e?.status));
    Alert.alert(
      "Update failed",
      e?.data?.message ||
        (isNetworkError
          ? "The network connection was interrupted. Check mobile data and try again."
          : e?.message) ||
        "Could not update order status. Please try again.",
    );
  };

  const confirmStatusUpdate = async (
    orderId: string,
    status: "Rider Picked Up" | "Delivered",
  ): Promise<boolean> => {
    if (status === "Delivered") {
      try {
        const history = await qc.fetchQuery(getGetOrderHistoryQueryOptions());
        const latest = history.find((item) => item.id === orderId);
        return Boolean(
          latest?.timeWhenDelivered || latest?.status === "Delivered",
        );
      } catch {
        return false;
      }
    }

    const refreshed = await ordersQ.refetch();
    const latest = refreshed.data?.find((item) => item.id === orderId);
    return Boolean(
      latest?.pickUpTime ||
        latest?.status === "Rider Picked Up" ||
        latest?.status === "Delivered",
    );
  };

  const setStatus = async (
    order: RiderOrder,
    status: "Rider Picked Up" | "Delivered",
  ) => {
    try {
      await statusM.mutateAsync({ orderId: order.id, data: { status } });
      onMutated();
    } catch (error) {
      if (await confirmStatusUpdate(order.id, status)) {
        onMutated();
        return;
      }
      onMutateError(error);
    }
  };

  const markArrived = async (order: RiderOrder) => {
    try {
      await arrivedM.mutateAsync({ orderId: order.id });
      onMutated();
    } catch (error) {
      // A mobile connection can drop after the API commits the update but before
      // the response reaches the device. Confirm current state before telling the
      // rider the action failed.
      const refreshed = await ordersQ.refetch();
      const latest = refreshed.data?.find((item) => item.id === order.id);
      if (latest?.riderArrived || latest?.status === "Rider Picked Up") {
        onMutated();
        return;
      }
      onMutateError(error);
    }
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
    Alert.alert(
      "Confirm delivery",
      "Are you sure you want to mark this order as delivered?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Mark as delivered",
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

      <OrderCapacityStatus
        orders={orders}
        orderLimitExempt={riderQ.data?.orderLimitExempt}
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
        style={{ flex: 1 }}
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
        ListFooterComponent={<DeliveryStopSequence orders={orders} />}
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
