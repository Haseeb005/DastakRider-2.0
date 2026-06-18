import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text,
  View,
  ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

type IconName = React.ComponentProps<typeof Feather>["name"];

type BtnVariant =
  | "primary"
  | "secondary"
  | "success"
  | "info"
  | "destructive"
  | "outline";

export function Button({
  label,
  onPress,
  variant = "primary",
  loading,
  disabled,
  icon,
  style,
  testID,
}: {
  label: string;
  onPress?: () => void;
  variant?: BtnVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: ViewStyle;
  testID?: string;
}) {
  const c = useColors();
  const bg: Record<BtnVariant, string> = {
    primary: c.primary,
    success: c.success,
    info: c.info,
    destructive: c.destructive,
    secondary: c.secondary,
    outline: "transparent",
  };
  const fg =
    variant === "secondary"
      ? c.secondaryForeground
      : variant === "outline"
        ? c.foreground
        : "#FFFFFF";
  const isDisabled = !!disabled || !!loading;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        {
          backgroundColor: bg[variant],
          borderRadius: c.radius,
          paddingVertical: 13,
          paddingHorizontal: 18,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          borderWidth: variant === "outline" ? 1 : 0,
          borderColor: c.border,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style as ViewStyle,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Feather name={icon} size={18} color={fg} /> : null}
          <Text
            style={{ color: fg, fontFamily: "Inter_600SemiBold", fontSize: 15 }}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const c = useColors();
  return (
    <View
      style={[
        {
          backgroundColor: c.card,
          borderRadius: c.radius,
          padding: 16,
          borderWidth: 1,
          borderColor: c.border,
        },
        style as ViewStyle,
      ]}
    >
      {children}
    </View>
  );
}

export function Badge({
  label,
  bg,
  fg,
}: {
  label: string;
  bg: string;
  fg: string;
}) {
  return (
    <View
      style={{
        backgroundColor: bg,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        alignSelf: "flex-start",
      }}
    >
      <Text style={{ color: fg, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
        {label}
      </Text>
    </View>
  );
}

export function ScreenHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top + 8;
  return (
    <View
      style={{
        paddingTop: topPad,
        paddingHorizontal: 20,
        paddingBottom: 12,
        backgroundColor: c.background,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 26,
              color: c.foreground,
            }}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={{
                fontFamily: "Inter_400Regular",
                fontSize: 13,
                color: c.mutedForeground,
                marginTop: 2,
              }}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right}
      </View>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
}) {
  const c = useColors();
  return (
    <View
      style={{
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 56,
        paddingHorizontal: 32,
        gap: 10,
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
        <Feather name={icon} size={28} color={c.mutedForeground} />
      </View>
      <Text
        style={{
          fontFamily: "Inter_600SemiBold",
          fontSize: 16,
          color: c.foreground,
        }}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text
          style={{
            fontFamily: "Inter_400Regular",
            fontSize: 13,
            color: c.mutedForeground,
            textAlign: "center",
            lineHeight: 19,
          }}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function Loading() {
  const c = useColors();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: c.background,
      }}
    >
      <ActivityIndicator color={c.primary} size="large" />
    </View>
  );
}
