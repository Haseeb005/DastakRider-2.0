/**
 * ChatBanner
 *
 * In-app slide-in notification banner shown when a customer sends a message
 * while the app is in the foreground. Uses a transparent Modal so it renders
 * above the tab navigator regardless of which screen is currently active.
 *
 * Slides in with a spring animation and auto-dismisses after 5 s.
 * Tapping the banner navigates to the chat screen.
 */
import { Icon } from "@/components/Icon";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef } from "react";
import {
  Animated,
  Modal,
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
  /** Called once the banner finishes its exit animation. */
  onDismiss: () => void;
}

const SLIDE_DIST = 100; // px above viewport to start/end

export function ChatBanner({ banner, onDismiss }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const translateY = useRef(new Animated.Value(-SLIDE_DIST)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Track whether the modal has been mounted so we can avoid animating before mount.
  const mountedRef = useRef(false);

  const slideOut = useCallback(() => {
    clearTimeout(dismissTimer.current);
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -SLIDE_DIST,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      mountedRef.current = false;
      onDismiss();
    });
  }, [translateY, opacity, onDismiss]);

  useEffect(() => {
    if (!banner) return;

    clearTimeout(dismissTimer.current);

    // Reset to off-screen, then spring in.
    translateY.setValue(-SLIDE_DIST);
    opacity.setValue(0);
    mountedRef.current = true;

    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        tension: 65,
        friction: 10,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();

    dismissTimer.current = setTimeout(slideOut, 5_000);
    return () => clearTimeout(dismissTimer.current);
  }, [banner?.orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePress = () => {
    slideOut();
    if (!banner) return;
    const params = new URLSearchParams();
    if (banner.customerName) params.set("customerName", banner.customerName);
    if (banner.orderNum) params.set("orderNum", banner.orderNum);
    router.push(`/chat/${banner.orderId}?${params.toString()}` as any);
  };

  return (
    <Modal
      visible={!!banner}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={slideOut}
    >
      {/* Full-screen overlay — passes touches through everywhere except the banner */}
      <View style={styles.overlay} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.container,
            { top: insets.top + 10, transform: [{ translateY }], opacity },
          ]}
        >
          <Pressable onPress={handlePress} style={styles.inner}>
            {/* Icon */}
            <View style={styles.iconWrap}>
              <Icon name="message-circle" size={20} color="#fff" />
            </View>

            {/* Text */}
            <View style={styles.textWrap}>
              <Text style={styles.title} numberOfLines={1}>
                {banner?.customerName ?? "Customer"}
              </Text>
              <Text style={styles.body} numberOfLines={1}>
                Sent you a message · Tap to reply
              </Text>
            </View>

            {/* Dismiss */}
            <Pressable onPress={slideOut} style={styles.closeBtn} hitSlop={12}>
              <Icon name="x" size={16} color="rgba(255,255,255,0.75)" />
            </Pressable>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  container: {
    position: "absolute",
    left: 16,
    right: 16,
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
