import * as Haptics from "expo-haptics";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  Text,
  View,
} from "react-native";

import { Icon } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";

const HOLD_DURATION_MS = 1_200;

export function HoldToAcceptButton({
  onComplete,
  loading = false,
  disabled = false,
}: {
  onComplete: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const c = useColors();
  const progress = useRef(new Animated.Value(0)).current;
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completed = useRef(false);
  const [isHolding, setIsHolding] = useState(false);
  const isDisabled = disabled || loading;

  const clearHoldTimer = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const resetProgress = () => {
    clearHoldTimer();
    setIsHolding(false);
    if (!completed.current) {
      Animated.timing(progress, {
        toValue: 0,
        duration: 160,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }).start();
    }
  };

  useEffect(() => {
    return () => {
      clearHoldTimer();
      progress.stopAnimation();
    };
  }, [progress]);

  useEffect(() => {
    if (isDisabled) {
      clearHoldTimer();
      setIsHolding(false);
    }
  }, [isDisabled]);

  useEffect(() => {
    if (!loading && completed.current) {
      completed.current = false;
      progress.setValue(0);
    }
  }, [loading, progress]);

  const startHold = () => {
    if (isDisabled || completed.current) return;
    completed.current = false;
    setIsHolding(true);
    progress.setValue(0);
    Haptics.selectionAsync().catch(() => {});
    Animated.timing(progress, {
      toValue: 1,
      duration: HOLD_DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      completed.current = true;
      setIsHolding(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      onComplete();
    }, HOLD_DURATION_MS);
  };

  const finishHold = () => {
    if (!completed.current) resetProgress();
  };

  const fillWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  const label = loading
    ? "Accepting order…"
    : isHolding
      ? "Keep holding to accept"
      : "Hold to accept";

  return (
    <Pressable
      onPressIn={startHold}
      onPressOut={finishHold}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel="Hold to accept order"
      accessibilityHint="Press and hold for a moment to accept this order."
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => ({
        minHeight: 52,
        borderRadius: 999,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: c.primary,
        opacity: isDisabled ? 0.6 : pressed ? 0.92 : 1,
      })}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: fillWidth,
          backgroundColor: "rgba(0,0,0,0.18)",
        }}
      />
      <View
        pointerEvents="none"
        style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Icon name="shield-check" size={18} color="#FFFFFF" />
        )}
        <Text
          style={{
            color: "#FFFFFF",
            fontFamily: "Inter_700Bold",
            fontSize: 15,
          }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}