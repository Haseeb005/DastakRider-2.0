import { Feather } from "@expo/vector-icons";
import {
  getGetActiveOrdersQueryKey,
  useGetActiveOrders,
} from "@workspace/api-client-react";
import type { SFSymbol } from "expo-symbols";
import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

const TABS: {
  name: string;
  title: string;
  feather: FeatherName;
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
    title: "History",
    feather: "clock",
    sf: "clock",
    sfSelected: "clock.fill",
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

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  const { token } = useAuth();
  const activeQ = useGetActiveOrders({
    query: {
      queryKey: getGetActiveOrdersQueryKey(),
      enabled: !!token,
      refetchInterval: 10000,
    },
  });
  const activeCount = activeQ.data?.length ?? 0;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarLabelStyle: { fontFamily: "Inter_500Medium", fontSize: 11 },
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.background },
              ]}
            />
          ) : null,
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarBadge:
              t.name === "active" && activeCount > 0 ? activeCount : undefined,
            tabBarIcon: ({ color }) =>
              isIOS ? (
                <SymbolView name={t.sf} tintColor={color} size={24} />
              ) : (
                <Feather name={t.feather} size={22} color={color} />
              ),
          }}
        />
      ))}
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
