import { Icon as AppIcon, type IconName } from "@/components/Icon";
import { ChatBanner, type BannerInfo } from "@/components/ChatBanner";
import {
  getGetActiveOrdersQueryKey,
  getGetAvailableOrdersQueryKey,
  getGetRiderMeQueryKey,
  useGetActiveOrders,
  useGetAvailableOrders,
  useGetRiderMe,
} from "@workspace/api-client-react";
import type { SFSymbol } from "expo-symbols";
import { scheduleNotificationAsync } from "@/lib/localPush";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import { getClearedAt, getOpenChatOrderId, subscribe as subscribeBadgeStore } from "@/lib/chatBadgeStore";
import {
  clearOrderBadge,
  getOrderBadgeCount,
  setOrderBadgeCount,
  subscribe as subscribeOrderBadge,
} from "@/lib/orderBadgeStore";
import { useChatWatcher } from "@/lib/useChatWatcher";

type TabBarProps = Parameters<
  NonNullable<React.ComponentProps<typeof Tabs>["tabBar"]>
>[0];

const TABS: {
  name: string;
  title: string;
  feather: IconName;
  sf: SFSymbol;
  sfSelected: SFSymbol;
}[] = [
  {
    name: "index",
    title: "Orders",
    feather: "package",
    sf: "shippingbox",
    sfSelected: "shippingbox.fill",
  },
  {
    name: "active",
    title: "Active",
    feather: "navigation",
    sf: "bicycle",
    sfSelected: "bicycle",
  },
  {
    name: "history",
    title: "Earnings",
    feather: "credit-card",
    sf: "creditcard",
    sfSelected: "creditcard.fill",
  },
  {
    name: "profile",
    title: "Profile",
    feather: "user",
    sf: "person",
    sfSelected: "person.fill",
  },
];

function NativeTabLayout() {
  return (
    <NativeTabs>
      {TABS.map((t) => (
        <NativeTabs.Trigger key={t.name} name={t.name}>
          <Icon sf={{ default: t.sf, selected: t.sfSelected }} />
          <Label>{t.title}</Label>
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}

function CustomTabBar({
  state,
  navigation,
  insets,
  unreadMessages = 0,
}: TabBarProps & { unreadMessages?: number }) {
  const c = useColors();
  const { token } = useAuth();

  // Subscribe to new-order badge count so the Orders tab re-renders.
  const [, tickOrder] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeOrderBadge(tickOrder), []);
  const activeQ = useGetActiveOrders({
    query: {
      queryKey: getGetActiveOrdersQueryKey(),
      enabled: !!token,
      refetchInterval: 10000,
    },
  });
  const activeCount = activeQ.data?.length ?? 0;

  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        flexDirection: "row",
        backgroundColor: c.card,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingTop: 10,
        paddingBottom: Math.max(insets.bottom, 14),
        paddingHorizontal: 12,
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: -6 },
        elevation: 12,
      }}
    >
      {state.routes.map((route, index) => {
        const meta = TABS.find((t) => t.name === route.name);
        if (!meta) return null;

        const isFocused = state.index === index;
        const newOrderCount = getOrderBadgeCount();
        const hasNewOrders = route.name === "index" && newOrderCount > 0;
        // Orders tab turns crimson when there are new available orders.
        const color = hasNewOrders
          ? "#DB143C"
          : isFocused
            ? c.primary
            : c.mutedForeground;
        const showBadge = route.name === "active" && activeCount > 0;
        const showUnreadDot =
          route.name === "active" && unreadMessages > 0;

        const onPress = () => {
          // Clear new-order badge the instant the rider taps the Orders tab.
          if (route.name === "index") clearOrderBadge();
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={meta.title}
            style={{ flex: 1, alignItems: "center", paddingTop: 8 }}
          >
            {isFocused ? (
              <View
                style={{
                  position: "absolute",
                  top: -2,
                  width: 28,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: c.primary,
                }}
              />
            ) : null}
            <View>
              <AppIcon name={meta.feather} size={24} color={color} />
              {hasNewOrders ? (
                <View
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -10,
                    minWidth: 18,
                    height: 18,
                    borderRadius: 9,
                    backgroundColor: "#DB143C",
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: 4,
                  }}
                >
                  <Text
                    style={{
                      color: "#FFFFFF",
                      fontSize: 10,
                      fontFamily: "Inter_700Bold",
                    }}
                  >
                    {newOrderCount}
                  </Text>
                </View>
              ) : null}
              {showBadge ? (
                <View
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -10,
                    minWidth: 18,
                    height: 18,
                    borderRadius: 9,
                    backgroundColor: c.primary,
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: 4,
                  }}
                >
                  <Text
                    style={{
                      color: "#FFFFFF",
                      fontSize: 10,
                      fontFamily: "Inter_700Bold",
                    }}
                  >
                    {activeCount}
                  </Text>
                </View>
              ) : null}
              {showUnreadDot ? (
                <View
                  style={{
                    position: "absolute",
                    top: -4,
                    left: -4,
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: "#DB143C",
                    borderWidth: 1.5,
                    borderColor: c.card,
                  }}
                />
              ) : null}
            </View>
            <Text
              style={{
                marginTop: 4,
                fontSize: 11,
                color,
                fontFamily: isFocused ? "Inter_700Bold" : "Inter_500Medium",
              }}
            >
              {meta.title}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ClassicTabLayout({ unreadMessages }: { unreadMessages: number }) {
  return (
    <Tabs
      tabBar={(props) => (
        <CustomTabBar {...props} unreadMessages={unreadMessages} />
      )}
      screenOptions={{ headerShown: false }}
    >
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.title }} />
      ))}
    </Tabs>
  );
}

export default function TabLayout() {
  const { token } = useAuth();
  const activeQ = useGetActiveOrders({
    query: {
      queryKey: getGetActiveOrdersQueryKey(),
      enabled: !!token,
      refetchInterval: 10000,
    },
  });

  // ── Available-orders badge ────────────────────────────────────────────────
  // We detect new "Admin Accepted" orders here (always mounted) rather than
  // inside index.tsx (only mounted after first visit to Orders tab).
  const meQ = useGetRiderMe({ query: { queryKey: getGetRiderMeQueryKey(), enabled: !!token } });
  const isOnline = !!meQ.data?.isOnline;
  const availableQ = useGetAvailableOrders({
    query: {
      queryKey: getGetAvailableOrdersQueryKey(),
      enabled: !!token && isOnline,
      refetchInterval: isOnline ? 3000 : false,
    },
  });

  const seenOrderIds = useRef<Set<string>>(new Set());
  const seededOrders = useRef(false);

  useEffect(() => {
    const orders = availableQ.data;
    if (!orders) return;
    if (!isOnline) {
      // Rider went offline — reset so we re-seed when they come back online.
      seenOrderIds.current = new Set();
      seededOrders.current = false;
      setOrderBadgeCount(0);
      return;
    }
    const presentIds = new Set(orders.map((o) => o.id));
    if (!seededOrders.current) {
      // First load: seed seen set silently so existing orders don't trigger badge.
      orders.forEach((o) => seenOrderIds.current.add(o.id));
      seededOrders.current = true;
      return;
    }
    const fresh = orders.filter((o) => !seenOrderIds.current.has(o.id));
    fresh.forEach((o) => seenOrderIds.current.add(o.id));

    if (fresh.length > 0) {
      // New orders arrived — add to badge count.
      setOrderBadgeCount(getOrderBadgeCount() + fresh.length);
    } else {
      // Prune orders that left (accepted by another rider); cap badge at remaining.
      const remaining = Array.from(seenOrderIds.current).filter((id) => presentIds.has(id)).length;
      // Only reduce if badge would exceed remaining (don't clear manually-cleared badge).
      const current = getOrderBadgeCount();
      if (current > remaining) setOrderBadgeCount(remaining);
    }
  }, [availableQ.data, isOnline]);
  // ─────────────────────────────────────────────────────────────────────────

  // Chat watcher runs at the tabs-root level so it stays alive on every tab.
  const activeOrderIds = (activeQ.data ?? []).map((o) => o.id);

  // Re-render whenever the rider opens or closes a chat screen so the dot
  // disappears immediately while they are actively reading.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeBadgeStore(rerender), []);

  // Banner + push notification state lives here so it fires on any tab.
  const [banner, setBanner] = useState<BannerInfo | null>(null);
  const activeOrdersRef = useRef(activeQ.data ?? []);
  activeOrdersRef.current = activeQ.data ?? [];

  const onNewMessage = useCallback((orderId: string) => {
    // Don't interrupt the rider if they're already in this chat.
    if (getOpenChatOrderId() === orderId) return;

    const order = activeOrdersRef.current.find((o) => o.id === orderId);
    setBanner({
      orderId,
      customerName: order?.userName ?? undefined,
      orderNum: order?.orderNum ? String(order.orderNum) : undefined,
    });

    // Local push — shows a system notification when the app is foregrounded
    // on a different screen. (Background push requires server-side FCM/APNs.)
    scheduleNotificationAsync({
      content: {
        title: order?.userName
          ? `Message from ${order.userName}`
          : "New message from customer",
        body: "Tap to reply",
        sound: true,
        data: { orderId, screen: "chat" },
      },
      trigger: null,
    }).catch(() => {});
  }, []);

  const { messagesByOrderId } = useChatWatcher(activeOrderIds, onNewMessage);

  // Total unread customer messages across all active orders — drives the
  // red dot on the Active tab so riders notice new messages from any tab.
  // Uses the getClearedAt watermark (set when rider opens a chat) so the dot
  // clears immediately on the client without waiting for the server read flag.
  const openChatOrderId = getOpenChatOrderId();
  const totalUnreadMessages = Object.entries(messagesByOrderId).reduce(
    (sum, [orderId, msgs]) => {
      if (orderId === openChatOrderId) return sum; // rider is in this chat right now
      const clearedAt = getClearedAt(orderId);
      return (
        sum +
        msgs.filter((m) => {
          if (m.fromRole !== "customer" || m.read) return false;
          if (clearedAt > 0) {
            // Only count messages that arrived after the rider last read this chat.
            if (m.createdAt) return new Date(m.createdAt).getTime() > clearedAt;
            return false; // no timestamp — assume seen
          }
          return true; // rider has never opened this chat
        }).length
      );
    },
    0,
  );

  if (isLiquidGlassAvailable()) {
    return (
      <>
        <NativeTabLayout />
        <ChatBanner banner={banner} onDismiss={() => setBanner(null)} />
      </>
    );
  }
  return (
    <>
      <ClassicTabLayout unreadMessages={totalUnreadMessages} />
      <ChatBanner banner={banner} onDismiss={() => setBanner(null)} />
    </>
  );
}
