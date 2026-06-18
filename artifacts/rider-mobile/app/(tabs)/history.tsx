import {
  getGetOrderHistoryQueryKey,
  GetOrderHistoryPeriod,
  useGetOrderHistory,
  useGetRiderEarnings,
  type GetOrderHistoryPeriod as Period,
  type RiderOrder,
} from "@workspace/api-client-react";
import React, { useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";

import { OrderCard } from "@/components/OrderCard";
import { OrderDetailModal } from "@/components/OrderDetailModal";
import { EmptyState, ScreenHeader } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { money } from "@/lib/format";

const PERIODS: { key: Period; label: string }[] = [
  { key: GetOrderHistoryPeriod.today, label: "Today" },
  { key: GetOrderHistoryPeriod.week, label: "Week" },
  { key: GetOrderHistoryPeriod.month, label: "Month" },
  { key: GetOrderHistoryPeriod.all, label: "All" },
];

const PERIOD_HEADING: Record<Period, string> = {
  today: "Today's",
  week: "This week's",
  month: "This month's",
  all: "Total",
};

function MiniStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  const c = useColors();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c.card,
        borderRadius: c.radius,
        borderWidth: 1,
        borderColor: c.border,
        padding: 12,
      }}
    >
      <Text
        style={{
          fontFamily: "Inter_500Medium",
          fontSize: 11,
          color: c.mutedForeground,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontFamily: "Inter_700Bold",
          fontSize: 16,
          color: c.foreground,
          marginTop: 4,
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          fontFamily: "Inter_400Regular",
          fontSize: 11,
          color: c.mutedForeground,
          marginTop: 2,
        }}
      >
        {sub}
      </Text>
    </View>
  );
}

export default function HistoryScreen() {
  const c = useColors();
  const [period, setPeriod] = useState<Period>(GetOrderHistoryPeriod.today);
  const [selected, setSelected] = useState<RiderOrder | null>(null);

  const earningsQ = useGetRiderEarnings();
  const historyQ = useGetOrderHistory(
    { period },
    {
      query: {
        queryKey: getGetOrderHistoryQueryKey({ period }),
        refetchInterval: 30000,
      },
    },
  );
  const e = earningsQ.data;
  const orders = historyQ.data ?? [];

  const periodData = {
    today: {
      earnings: e?.todayEarnings,
      deliveries: e?.todayDeliveries,
      cash: e?.todayOrderAmount,
    },
    week: {
      earnings: e?.weekEarnings,
      deliveries: e?.weekDeliveries,
      cash: e?.weekOrderAmount,
    },
    month: {
      earnings: e?.monthEarnings,
      deliveries: e?.monthDeliveries,
      cash: e?.monthOrderAmount,
    },
    all: {
      earnings: e?.totalEarnings,
      deliveries: e?.totalDeliveries,
      cash: e?.totalOrderAmount,
    },
  }[period];

  const header = (
    <View style={{ paddingTop: 4 }}>
      <View
        style={{
          backgroundColor: c.success,
          borderRadius: c.radius,
          padding: 18,
          marginBottom: 12,
        }}
      >
        <Text
          style={{
            fontFamily: "Inter_500Medium",
            fontSize: 13,
            color: "rgba(255,255,255,0.85)",
          }}
        >
          Total earnings
        </Text>
        <Text
          style={{
            fontFamily: "Inter_700Bold",
            fontSize: 30,
            color: "#FFFFFF",
            marginTop: 4,
          }}
        >
          {money(e?.totalEarnings)}
        </Text>
        <Text
          style={{
            fontFamily: "Inter_400Regular",
            fontSize: 13,
            color: "rgba(255,255,255,0.85)",
            marginTop: 2,
          }}
        >
          {e?.totalDeliveries ?? 0} deliveries · {(e?.rating ?? 0).toFixed(1)}★
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
        <MiniStat
          label="Today"
          value={money(e?.todayEarnings)}
          sub={`${e?.todayDeliveries ?? 0} orders`}
        />
        <MiniStat
          label="Week"
          value={money(e?.weekEarnings)}
          sub={`${e?.weekDeliveries ?? 0} orders`}
        />
        <MiniStat
          label="Month"
          value={money(e?.monthEarnings)}
          sub={`${e?.monthDeliveries ?? 0} orders`}
        />
      </View>

      <View
        style={{
          flexDirection: "row",
          backgroundColor: c.muted,
          borderRadius: c.radius,
          padding: 4,
          marginBottom: 14,
        }}
      >
        {PERIODS.map((p) => {
          const active = period === p.key;
          return (
            <Pressable
              key={p.key}
              onPress={() => setPeriod(p.key)}
              style={{
                flex: 1,
                paddingVertical: 9,
                borderRadius: c.radius - 4,
                backgroundColor: active ? c.card : "transparent",
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 13,
                  color: active ? c.foreground : c.mutedForeground,
                }}
              >
                {p.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          backgroundColor: c.card,
          borderRadius: c.radius,
          borderWidth: 1,
          borderColor: c.border,
          padding: 14,
          marginBottom: 16,
        }}
      >
        <View>
          <Text
            style={{
              fontFamily: "Inter_400Regular",
              fontSize: 11,
              color: c.mutedForeground,
            }}
          >
            Earnings
          </Text>
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 17,
              color: c.success,
              marginTop: 2,
            }}
          >
            {money(periodData.earnings)}
          </Text>
        </View>
        <View style={{ alignItems: "center" }}>
          <Text
            style={{
              fontFamily: "Inter_400Regular",
              fontSize: 11,
              color: c.mutedForeground,
            }}
          >
            Deliveries
          </Text>
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 17,
              color: c.foreground,
              marginTop: 2,
            }}
          >
            {periodData.deliveries ?? 0}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text
            style={{
              fontFamily: "Inter_400Regular",
              fontSize: 11,
              color: c.mutedForeground,
            }}
          >
            Order amount
          </Text>
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 17,
              color: c.foreground,
              marginTop: 2,
            }}
          >
            {money(periodData.cash)}
          </Text>
        </View>
      </View>

      <Text
        style={{
          fontFamily: "Inter_600SemiBold",
          fontSize: 15,
          color: c.foreground,
          marginBottom: 10,
        }}
      >
        {PERIOD_HEADING[period]} deliveries
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title="History" subtitle="Your earnings and deliveries" />
      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        ListHeaderComponent={header}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 4,
          paddingBottom: Platform.OS === "web" ? 120 : 110,
        }}
        refreshControl={
          <RefreshControl
            refreshing={historyQ.isRefetching || earningsQ.isRefetching}
            onRefresh={() => {
              historyQ.refetch();
              earningsQ.refetch();
            }}
            tintColor={c.primary}
          />
        }
        renderItem={({ item }) => (
          <OrderCard order={item} onPress={() => setSelected(item)} />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="clock"
            title="No deliveries"
            subtitle="No completed deliveries in this period."
          />
        }
      />

      <OrderDetailModal
        order={selected}
        visible={!!selected}
        onClose={() => setSelected(null)}
      />
    </View>
  );
}
