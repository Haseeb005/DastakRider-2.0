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
  Modal,
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

const PKT_MS = 5 * 60 * 60 * 1000;
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function pktToday(): Date {
  const shifted = new Date(Date.now() + PKT_MS);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    ),
  );
}

function dateKey(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function dateFromKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatSelectedDate(value: string): string {
  return dateFromKey(value).toLocaleDateString("en-PK", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function DatePickerModal({
  visible,
  selectedDate,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selectedDate: string | null;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const c = useColors();
  const initialDate = selectedDate ? dateFromKey(selectedDate) : pktToday();
  const [month, setMonth] = useState(
    () => new Date(Date.UTC(initialDate.getUTCFullYear(), initialDate.getUTCMonth(), 1)),
  );
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const firstWeekday = month.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells = Array.from({ length: firstWeekday + daysInMonth }, (_, index) =>
    index < firstWeekday ? null : new Date(Date.UTC(year, monthIndex, index - firstWeekday + 1)),
  );
  const todayKey = dateKey(pktToday());

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.45)" }}>
        <View style={{ backgroundColor: c.card, borderRadius: c.radius + 4, padding: 20, borderWidth: 1, borderColor: c.border }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Pressable
              onPress={() => setMonth(new Date(Date.UTC(year, monthIndex - 1, 1)))}
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: c.muted }}
            >
              <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 20 }}>‹</Text>
            </Pressable>
            <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 17 }}>
              {month.toLocaleDateString("en-PK", { timeZone: "UTC", month: "long", year: "numeric" })}
            </Text>
            <Pressable
              onPress={() => setMonth(new Date(Date.UTC(year, monthIndex + 1, 1)))}
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: c.muted }}
            >
              <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 20 }}>›</Text>
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", marginTop: 20 }}>
            {WEEKDAY_LABELS.map((label, index) => (
              <View key={`${label}-${index}`} style={{ width: `${100 / 7}%`, alignItems: "center", paddingBottom: 8 }}>
                <Text style={{ color: c.mutedForeground, fontFamily: "Inter_600SemiBold", fontSize: 11 }}>{label}</Text>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {cells.map((date, index) => {
              if (!date) return <View key={`blank-${index}`} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 3 }} />;
              const key = dateKey(date);
              const isSelected = selectedDate === key;
              const isFuture = key > todayKey;
              return (
                <View key={key} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 3 }}>
                  <Pressable
                    disabled={isFuture}
                    onPress={() => {
                      onSelect(key);
                      onClose();
                    }}
                    style={{ flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 18, backgroundColor: isSelected ? c.primary : "transparent" }}
                  >
                    <Text style={{ color: isSelected ? "#FFFFFF" : isFuture ? c.border : c.foreground, fontFamily: isSelected ? "Inter_700Bold" : "Inter_500Medium", fontSize: 13 }}>
                      {date.getUTCDate()}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 16 }}>
            <Pressable onPress={onClose} style={{ paddingVertical: 10, paddingHorizontal: 12 }}>
              <Text style={{ color: c.mutedForeground, fontFamily: "Inter_600SemiBold" }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                onSelect(todayKey);
                onClose();
              }}
              style={{ paddingVertical: 10, paddingHorizontal: 12 }}
            >
              <Text style={{ color: c.primary, fontFamily: "Inter_700Bold" }}>Today</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

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
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<RiderOrder | null>(null);

  const historyParams = selectedDate ? { date: selectedDate } : { period };
  const earningsQ = useGetRiderEarnings(selectedDate ? { date: selectedDate } : undefined);
  const historyQ = useGetOrderHistory(
    historyParams,
    {
      query: {
        queryKey: getGetOrderHistoryQueryKey(historyParams),
        refetchInterval: 30000,
      },
    },
  );
  const e = earningsQ.data;
  const orders = historyQ.data ?? [];

  const periodData = selectedDate
    ? {
        earnings: e?.selectedEarnings,
        deliveries: e?.selectedDeliveries,
        cash: e?.selectedOrderAmount,
      }
    : {
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
  const listHeading = selectedDate
    ? `${formatSelectedDate(selectedDate)} deliveries`
    : `${PERIOD_HEADING[period]} deliveries`;
  const hasError = historyQ.isError || (!!selectedDate && earningsQ.isError);

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
              onPress={() => {
                setSelectedDate(null);
                setPeriod(p.key);
              }}
              style={{
                flex: 1,
                paddingVertical: 9,
                borderRadius: c.radius - 4,
                backgroundColor: active && !selectedDate ? c.card : "transparent",
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 13,
                  color: active && !selectedDate ? c.foreground : c.mutedForeground,
                }}
              >
                {p.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <Pressable
          onPress={() => setPickerOpen(true)}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: c.card,
            borderRadius: c.radius,
            borderWidth: 1,
            borderColor: selectedDate ? c.primary : c.border,
            paddingHorizontal: 14,
            paddingVertical: 12,
          }}
        >
          <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
            {selectedDate ? "Selected date" : "Choose a date"}
          </Text>
          <Text style={{ color: selectedDate ? c.foreground : c.primary, fontFamily: "Inter_700Bold", fontSize: 13 }}>
            {selectedDate ? formatSelectedDate(selectedDate) : "Calendar"}
          </Text>
        </Pressable>
        {selectedDate ? (
          <Pressable onPress={() => setSelectedDate(null)} style={{ paddingHorizontal: 4, paddingVertical: 10 }}>
            <Text style={{ color: c.primary, fontFamily: "Inter_700Bold", fontSize: 13 }}>Clear</Text>
          </Pressable>
        ) : null}
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
        {listHeading}
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
          <OrderCard order={item} onPress={() => setSelected(item)}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                backgroundColor: c.muted,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            >
              <View>
                <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 11 }}>
                  Order amount
                </Text>
                <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 14, marginTop: 2 }}>
                  {money(item.total)}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 11 }}>
                  Your earning
                </Text>
                <Text style={{ color: c.success, fontFamily: "Inter_700Bold", fontSize: 14, marginTop: 2 }}>
                  {money(item.riderFare)}
                </Text>
              </View>
            </View>
          </OrderCard>
        )}
        ListEmptyComponent={
          historyQ.isLoading ? (
            <View style={{ alignItems: "center", paddingVertical: 36 }}>
              <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium" }}>Loading deliveries…</Text>
            </View>
          ) : hasError ? (
            <View style={{ alignItems: "center", paddingVertical: 36 }}>
              <Text style={{ color: c.destructive, fontFamily: "Inter_600SemiBold" }}>
                Could not load deliveries. Please try again.
              </Text>
            </View>
          ) : (
            <EmptyState
              icon="clock"
              title="No deliveries"
              subtitle="No completed deliveries for this selection."
            />
          )
        }
      />

      <DatePickerModal
        visible={pickerOpen}
        selectedDate={selectedDate}
        onSelect={setSelectedDate}
        onClose={() => setPickerOpen(false)}
      />

      <OrderDetailModal
        order={selected}
        visible={!!selected}
        onClose={() => setSelected(null)}
      />
    </View>
  );
}
