/**
 * ChatBanner
 *
 * In-app slide-in notification banner that appears at the top of the screen
 * when a customer sends a new message while the app is foregrounded and the
 * chat screen is not open.
 *
 * Slides in with a spring animation, auto-dismisses after 5 s, and navigates
 * to the chat screen when tapped.
 */
import { Icon } from "@/components/Icon";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface BannerInfo {
  orderId: string;
  customerName?: string;
  orderNum?: string;
}

interface Props {
  banner: BannerInfo | null;
  /** Called once the banner has finished its exit animation. */
  onDismiss: () => void;
}

const BANNER_HEIGHT = 72; // approximate; keeps animation crisp

export function ChatBanner({ banner, onDismiss }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const translateY = useRef(new Animated.Value(-BANNER_HEIGHT - 20)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const slideOut = useCallback(() => {
    clearTimeout(dismissTimer.current);
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -BANNER_HEIGHT - 20,
        duration: 260,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start(() => onDismiss());
  }, [translateY, opacity, onDismiss]);

  useEffect(() => {
    if (!banner) return;

    clearTimeout(dismissTimer.current);

    // Slide in
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        tension: 70,
        friction: 11,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    // Auto-dismiss after 5 s
    dismissTimer.current = setTimeout(slideOut, 5_000);

    return () => clearTimeout(dismissTimer.current);
  }, [banner?.orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!banner) return null;

  const handlePress = () => {
    slideOut();
    const params = new URLSearchParams();
    if (banner.customerName) params.set("customerName", banner.customerName);
    if (banner.orderNum) params.set("orderNum", banner.orderNum);
    router.push(`/chat/${banner.orderId}?${params.toString()}` as any);
  };

  return (
    <Animated.View
      style={[
        styles.container,
        {
          top: insets.top + 10,
          transform: [{ translateY }],
          opacity,
        },
      ]}
      pointerEvents="box-none"
    >
      <Pressable onPress={handlePress} style={styles.inner}>
        {/* Icon */}
        <View style={styles.iconWrap}>
          <Icon name="message-circle" size={20} color="#fff" />
        </View>

        {/* Text */}
        <View style={styles.textWrap}>
          <Text style={styles.title} numberOfLines={1}>
            {banner.customerName ?? "Customer"}
          </Text>
          <Text style={styles.body} numberOfLines={1}>
            {"Sent you a message · Tap to reply"}
          </Text>
        </View>

        {/* Dismiss */}
        <Pressable onPress={slideOut} style={styles.closeBtn} hitSlop={10}>
          <Icon name="x" size={16} color="rgba(255,255,255,0.75)" />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 9999,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#DB143C",
    borderRadius: 18,
    paddingVertical: 13,
    paddingHorizontal: 14,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 10,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
    lineHeight: 18,
  },
  body: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
  },
});
