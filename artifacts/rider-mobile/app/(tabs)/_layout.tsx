import { Feather } from "@expo/vector-icons";
import {
  getGetActiveOrdersQueryKey,
  useGetActiveOrders,
} from "@workspace/api-client-react";
import type { SFSymbol } from "expo-symbols";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

type TabBarProps = Parameters<
  NonNullable<React.ComponentProps<typeof Tabs>["tabBar"]>
>[0];

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

function CustomTabBar({ state, navigation, insets }: TabBarProps) {
  const c = useColors();
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
        const color = isFocused ? c.primary : c.mutedForeground;
        const showBadge = route.name === "active" && activeCount > 0;

        const onPress = () => {
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
              <Feather name={meta.feather} size={24} color={color} />
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

function ClassicTabLayout() {
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.title }} />
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
