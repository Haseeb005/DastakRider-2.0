import { Icon, type IconName } from "@/components/Icon";
import {
  getGetRiderMeQueryKey,
  useGetRiderMe,
  getGetRiderReviewsQueryKey,
  useGetRiderReviews,
  useLogoutRider,
  useUpdateRiderAvailability,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import * as Sentry from "@sentry/react-native";
import React, { useCallback } from "react";
import {
  Alert,
  ActivityIndicator,
  Platform,
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { Button, Loading, ScreenHeader } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/format";

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: string;
}) {
  const c = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 10,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: c.muted,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={icon} size={16} color={c.mutedForeground} />
      </View>
      <Text
        style={{
          flex: 1,
          fontFamily: "Inter_400Regular",
          fontSize: 14,
          color: c.mutedForeground,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontFamily: "Inter_600SemiBold",
          fontSize: 14,
          color: c.foreground,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function CollectionCard({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: "warning" | "info";
}) {
  const c = useColors();
  const bg = tone === "warning" ? c.warningBg : c.infoBg;
  const fg = tone === "warning" ? c.warning : c.info;
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: bg,
        borderRadius: c.radius,
        padding: 14,
      }}
    >
      <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: fg }}>
        {label}
      </Text>
      <Text
        style={{
          fontFamily: "Inter_700Bold",
          fontSize: 20,
          color: fg,
          marginTop: 6,
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          fontFamily: "Inter_400Regular",
          fontSize: 11,
          color: fg,
          marginTop: 4,
          opacity: 0.85,
        }}
      >
        {note}
      </Text>
    </View>
  );
}

function formatReviewDate(dateValue: string | null) {
  if (!dateValue) return "Date unavailable";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-PK", {
    timeZone: "Asia/Karachi",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function ProfileScreen() {
  const c = useColors();
  const qc = useQueryClient();
  const { signOut, token } = useAuth();

  const meQ = useGetRiderMe({
    query: { queryKey: getGetRiderMeQueryKey(), enabled: !!token },
  });
  const reviewsQ = useGetRiderReviews({
    query: {
      queryKey: getGetRiderReviewsQueryKey(),
      enabled: !!token,
      staleTime: 30_000,
    },
  });

  // Refetch every time the user navigates to this tab so cash/earnings are fresh.
  useFocusEffect(
    useCallback(() => {
      if (token) {
        qc.invalidateQueries({ queryKey: getGetRiderMeQueryKey() });
        qc.invalidateQueries({ queryKey: getGetRiderReviewsQueryKey() });
      }
    }, [token, qc]),
  );
  const rider = meQ.data;
  const isOnline = !!rider?.isOnline;

  const availabilityM = useUpdateRiderAvailability();
  const logoutM = useLogoutRider();

  const toggleOnline = () => {
    Haptics.selectionAsync().catch(() => {});
    availabilityM.mutate(
      { data: { isOnline: !isOnline } },
      {
        onSuccess: () =>
          qc.invalidateQueries({ queryKey: getGetRiderMeQueryKey() }),
      },
    );
  };

  const doLogout = () =>
    logoutM.mutate(undefined, { onSettled: () => signOut() });

  const confirmLogout = () => {
    // Alert.alert button callbacks don't fire on React Native Web, so fall back
    // to window.confirm there; native uses the proper Alert dialog.
    if (Platform.OS === "web") {
      const ok =
        typeof window === "undefined" ||
        window.confirm("You will be signed out of your account.");
      if (ok) doLogout();
      return;
    }
    Alert.alert("Logout?", "You will be signed out of your account.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: doLogout,
      },
    ]);
  };

  if (meQ.isLoading || !rider) return <Loading />;

  const initials = (rider.name || "R")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title="Profile" />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 4,
          paddingBottom: Platform.OS === "web" ? 120 : 110,
        }}
      >
        <View
          style={{
            backgroundColor: c.card,
            borderRadius: c.radius,
            borderWidth: 1,
            borderColor: c.border,
            padding: 18,
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <View
            style={{
              width: 76,
              height: 76,
              borderRadius: 38,
              backgroundColor: c.primary,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 12,
            }}
          >
            <Text
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 28,
                color: "#FFFFFF",
              }}
            >
              {initials}
            </Text>
          </View>
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 20,
              color: c.foreground,
            }}
          >
            {rider.name}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginTop: 4,
            }}
          >
            <Icon name="star" size={14} color={c.warning} />
            <Text
              style={{
                fontFamily: "Inter_500Medium",
                fontSize: 13,
                color: c.mutedForeground,
              }}
            >
              {(rider.rating ?? 0).toFixed(1)} ({rider.ratingCount ?? 0}) ·{" "}
              {rider.totalDeliveries ?? 0} deliveries
            </Text>
          </View>
        </View>

        <View
          style={{
            backgroundColor: c.card,
            borderRadius: c.radius,
            borderWidth: 1,
            borderColor: c.border,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 16,
                  color: c.foreground,
                }}
              >
                Customer Reviews
              </Text>
              <Text
                style={{
                  fontFamily: "Inter_400Regular",
                  fontSize: 13,
                  color: c.mutedForeground,
                  marginTop: 3,
                }}
              >
                {reviewsQ.data
                  ? `${reviewsQ.data.rating.toFixed(1)} average from ${reviewsQ.data.ratingCount} ${
                      reviewsQ.data.ratingCount === 1 ? "review" : "reviews"
                    }`
                  : "Feedback from your delivered orders"}
              </Text>
            </View>
            <TouchableOpacity
              accessibilityLabel="Refresh customer reviews"
              accessibilityRole="button"
              onPress={() => reviewsQ.refetch()}
              disabled={reviewsQ.isFetching}
              style={{ padding: 4, opacity: reviewsQ.isFetching ? 0.5 : 1 }}
            >
              <Icon
                name="refresh-cw"
                size={18}
                color={c.mutedForeground}
                style={reviewsQ.isFetching ? { transform: [{ rotate: "180deg" }] } : undefined}
              />
            </TouchableOpacity>
          </View>

          {reviewsQ.isLoading ? (
            <View
              accessibilityLabel="Loading customer reviews"
              style={{ alignItems: "center", paddingVertical: 28 }}
            >
              <ActivityIndicator color={c.primary} />
            </View>
          ) : reviewsQ.isError ? (
            <View
              style={{
                backgroundColor: c.accent,
                borderRadius: 10,
                padding: 12,
                marginTop: 14,
              }}
            >
              <Text
                style={{
                  fontFamily: "Inter_400Regular",
                  fontSize: 13,
                  lineHeight: 19,
                  color: c.accentForeground,
                }}
              >
                We couldn’t load your customer reviews.
              </Text>
              <TouchableOpacity
                onPress={() => reviewsQ.refetch()}
                style={{ marginTop: 7, alignSelf: "flex-start" }}
              >
                <Text
                  style={{
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 13,
                    color: c.accentForeground,
                  }}
                >
                  Try again
                </Text>
              </TouchableOpacity>
            </View>
          ) : reviewsQ.data?.reviews.length ? (
            <View style={{ marginTop: 14, gap: 10 }}>
              {reviewsQ.data.reviews.map((review) => (
                <View
                  key={review.id}
                  style={{
                    backgroundColor: c.muted,
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Icon
                          key={star}
                          name="star"
                          size={15}
                          color={star <= Math.round(review.rating) ? c.warning : c.border}
                        />
                      ))}
                      <Text
                        style={{
                          fontFamily: "Inter_600SemiBold",
                          fontSize: 12,
                          color: c.mutedForeground,
                          marginLeft: 4,
                        }}
                      >
                        {review.rating.toFixed(1)}
                      </Text>
                    </View>
                    <Text
                      style={{
                        flexShrink: 1,
                        fontFamily: "Inter_400Regular",
                        fontSize: 11,
                        color: c.mutedForeground,
                        textAlign: "right",
                      }}
                    >
                      {formatReviewDate(review.createdAt)}
                    </Text>
                  </View>
                  <Text
                    style={{
                      fontFamily: "Inter_400Regular",
                      fontSize: 13,
                      lineHeight: 19,
                      color: review.comment ? c.foreground : c.mutedForeground,
                      fontStyle: review.comment ? "normal" : "italic",
                      marginTop: 8,
                    }}
                  >
                    {review.comment || "No written comment"}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <View
              style={{
                backgroundColor: c.muted,
                borderRadius: 10,
                alignItems: "center",
                paddingHorizontal: 16,
                paddingVertical: 22,
                marginTop: 14,
              }}
            >
              <Icon name="star" size={26} color={c.border} />
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 14,
                  color: c.foreground,
                  marginTop: 8,
                }}
              >
                No customer reviews yet
              </Text>
              <Text
                style={{
                  fontFamily: "Inter_400Regular",
                  fontSize: 12,
                  lineHeight: 18,
                  color: c.mutedForeground,
                  textAlign: "center",
                  marginTop: 4,
                }}
              >
                Reviews will appear here after customers rate your deliveries.
              </Text>
            </View>
          )}
        </View>

        <View
          style={{
            backgroundColor: c.card,
            borderRadius: c.radius,
            borderWidth: 1,
            borderColor: c.border,
            padding: 16,
            marginBottom: 16,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: isOnline ? c.success : c.mutedForeground,
              }}
            />
            <Text
              style={{
                fontFamily: "Inter_600SemiBold",
                fontSize: 15,
                color: c.foreground,
              }}
            >
              {isOnline ? "Online — receiving orders" : "Offline"}
            </Text>
          </View>
          <Switch
            value={isOnline}
            onValueChange={toggleOnline}
            disabled={availabilityM.isPending}
            trackColor={{ false: c.input, true: c.success }}
            thumbColor="#FFFFFF"
          />
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
          <CollectionCard
            label="Cash in hand"
            value={money(rider.pendingCollection)}
            note="Collected from active orders"
            tone="warning"
          />
          <CollectionCard
            label="Owed to company"
            value={money(rider.unpaidCollection)}
            note="Unpaid so far"
            tone="info"
          />
        </View>

        <View
          style={{
            backgroundColor: c.card,
            borderRadius: c.radius,
            borderWidth: 1,
            borderColor: c.border,
            paddingHorizontal: 16,
            paddingVertical: 4,
            marginBottom: 16,
          }}
        >
          <InfoRow icon="phone" label="Phone" value={rider.phone} />
          <View style={{ height: 1, backgroundColor: c.border }} />
          <InfoRow icon="map-pin" label="City" value={rider.city} />
          <View style={{ height: 1, backgroundColor: c.border }} />
          <InfoRow icon="truck" label="Vehicle" value={rider.vehicleType} />
          <View style={{ height: 1, backgroundColor: c.border }} />
          <InfoRow
            icon="dollar-sign"
            label="Total earnings"
            value={money(rider.totalEarnings)}
          />
        </View>

        {/* DEV-ONLY: tap to send a test exception to Sentry */}
        {__DEV__ && (
          <TouchableOpacity
            onPress={() => {
              Sentry.captureException(new Error("Sentry test"));
              Alert.alert(
                "Sentry test fired",
                "Check your Sentry dashboard — the event should arrive within ~30 seconds.",
              );
            }}
            style={{
              backgroundColor: "#1a1a2e",
              borderRadius: c.radius,
              padding: 14,
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <Text
              style={{
                fontFamily: "Inter_600SemiBold",
                fontSize: 14,
                color: "#ffffff",
              }}
            >
              🐛 Test Sentry (dev only)
            </Text>
          </TouchableOpacity>
        )}

        <Button
          label="Logout"
          icon="log-out"
          variant="destructive"
          loading={logoutM.isPending}
          onPress={confirmLogout}
        />
      </ScrollView>
    </View>
  );
}
