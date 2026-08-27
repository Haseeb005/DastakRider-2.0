import {
  getGetRiderWalletQueryKey,
  useGetRiderWallet,
  type RiderChallenge,
  type RiderChallengeMilestone,
  type WalletTransaction,
} from "@workspace/api-client-react";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import { Icon } from "@/components/Icon";
import { ScreenHeader } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

function rupees(value = 0) {
  return `Rs. ${Math.round(value).toLocaleString("en-PK")}`;
}

function formatDate(value: string, options: Intl.DateTimeFormatOptions) {
  return new Date(value).toLocaleDateString("en-PK", {
    timeZone: "Asia/Karachi",
    ...options,
  });
}

function formatChallengePeriod(challenge: RiderChallenge) {
  const start = formatDate(challenge.periodStart, { month: "short", day: "numeric" });
  const end = formatDate(
    new Date(new Date(challenge.periodEnd).getTime() - 1).toISOString(),
    { month: "short", day: "numeric" },
  );
  return start === end ? start : `${start} – ${end}`;
}

function getChallengeMilestones(challenge: RiderChallenge): RiderChallengeMilestone[] {
  // Older API responses did not include milestones. Keep those challenges useful
  // while clients and the API roll out independently.
  const milestones = (challenge as RiderChallenge & {
    milestones?: RiderChallengeMilestone[];
  }).milestones;

  if (milestones?.length) {
    return milestones;
  }

  return [{
    target: challenge.target,
    reward: challenge.reward,
    earned: challenge.status === "completed" || challenge.progress >= challenge.target,
  }];
}

function WalletChallengeCard({ challenge }: { challenge: RiderChallenge }) {
  const c = useColors();
  const milestones = getChallengeMilestones(challenge);
  const payoutPaid = challenge.payoutStatus === "paid";
  const payoutPending = challenge.payoutStatus === "pending";
  const notEarned = challenge.payoutStatus === "not_earned";
  const expired = challenge.status === "expired";
  const periodInProgress = new Date(challenge.periodEnd).getTime() > Date.now();
  const nextMilestone = milestones.find((milestone) => !milestone.earned);
  const currentMilestone = nextMilestone ?? milestones[milestones.length - 1];
  const stageTarget = currentMilestone?.target ?? challenge.target;
  const progress = stageTarget > 0
    ? Math.min(100, Math.round((challenge.progress / stageTarget) * 100))
    : 0;
  const remaining = currentMilestone ? Math.max(currentMilestone.target - challenge.progress, 0) : 0;
  const tone = payoutPaid ? c.successForeground : expired || notEarned ? c.mutedForeground : c.primary;
  const label = challenge.kind === "daily" ? "Today's challenge" : "Weekly challenge";
  const periodLabel = challenge.kind === "daily" ? "day" : "week";
  const endLabel = challenge.kind === "daily"
    ? "Ends today"
    : `Ends ${formatDate(new Date(new Date(challenge.periodEnd).getTime() - 1).toISOString(), { weekday: "short", day: "numeric", month: "short" })}`;
  const statusLabel = payoutPaid
    ? "Paid"
    : periodInProgress
      ? "In progress"
    : payoutPending
      ? "Bonus pending"
      : notEarned
        ? "No bonus"
        : "In progress";

  return (
    <View
      style={{
        backgroundColor: c.card,
        borderRadius: 20,
        padding: 16,
        borderWidth: 1,
        borderColor: payoutPaid ? c.successBg : c.border,
        gap: 14,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flexDirection: "row", flex: 1, gap: 10, alignItems: "center" }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: payoutPaid ? c.successBg : c.accent,
            }}
          >
            <Icon name={challenge.kind === "daily" ? "zap" : "target"} size={20} color={tone} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: c.foreground }}>
              {label}
            </Text>
            <Text style={{ marginTop: 2, fontFamily: "Inter_500Medium", fontSize: 12, color: c.mutedForeground }}>
              {challenge.tier} · {challenge.target}-delivery target
            </Text>
          </View>
        </View>
        <View
          style={{
              backgroundColor: payoutPaid ? c.successBg : expired || notEarned ? c.muted : c.accent,
            paddingHorizontal: 9,
            paddingVertical: 5,
            borderRadius: 999,
          }}
        >
          <Text style={{ color: tone, fontFamily: "Inter_700Bold", fontSize: 11 }}>
            {statusLabel}
          </Text>
        </View>
      </View>

      <View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 7 }}>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: c.foreground }}>
            Stage: {challenge.progress} / {stageTarget} deliveries
          </Text>
          <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: tone }}>{progress}%</Text>
        </View>
        <View style={{ height: 8, borderRadius: 999, overflow: "hidden", backgroundColor: c.muted }}>
          <View style={{ width: `${progress}%`, height: "100%", borderRadius: 999, backgroundColor: tone }} />
        </View>
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12, flex: 1 }}>{endLabel}</Text>
        {periodInProgress ? (
          <Text style={{ color: c.primary, fontFamily: "Inter_700Bold", fontSize: 12 }}>
            In progress
          </Text>
        ) : payoutPending ? (
          <Text style={{ color: c.primary, fontFamily: "Inter_700Bold", fontSize: 12 }}>
            Bonus pending
          </Text>
        ) : currentMilestone && !notEarned ? (
          <Text style={{ color: expired ? c.mutedForeground : c.primary, fontFamily: "Inter_700Bold", fontSize: 12 }}>
            {remaining} rides to go
          </Text>
        ) : (
          <Text style={{ color: tone, fontFamily: "Inter_700Bold", fontSize: 12 }}>
            {payoutPaid ? `+${rupees(challenge.bonusAmount)} paid` : "No bonus earned"}
          </Text>
        )}
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 13 }}>
          Up to {rupees(challenge.reward)} extra bonus available
        </Text>
        <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 11, lineHeight: 16 }}>
          {challenge.periodDeliveries} eligible deliveries this {periodLabel} · only your highest reached tier is paid at period end.
        </Text>
        {milestones.map((milestone, index) => {
          const earned = milestone.earned;
          const milestonePaid = payoutPaid && milestone.reward === challenge.bonusAmount;
          return (
            <View
              key={`${milestone.target}-${milestone.reward}-${index}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                padding: 11,
                borderRadius: 12,
                backgroundColor: milestonePaid ? c.successBg : c.muted,
              }}
            >
              <Icon name={milestonePaid ? "check-circle" : "target"} size={18} color={milestonePaid ? c.successForeground : c.mutedForeground} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.foreground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                  {milestone.target} deliveries
                </Text>
                <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 11, marginTop: 2 }}>
                  {milestonePaid
                    ? "Paid"
                    : earned
                      ? periodInProgress ? "Target reached · in progress" : payoutPending ? "Target reached · bonus pending" : "Target reached"
                      : milestone === currentMilestone ? "Current stage" : "Next tier"}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ color: earned ? c.successForeground : c.foreground, fontFamily: "Inter_700Bold", fontSize: 13 }}>
                  +{rupees(milestone.reward)}
                </Text>
                  {!earned && milestone === currentMilestone && !notEarned ? (
                  <Text style={{ color: c.primary, fontFamily: "Inter_600SemiBold", fontSize: 10, marginTop: 2 }}>
                    {remaining} to go
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>

      {!payoutPaid && !notEarned ? (
        <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 11, lineHeight: 16 }}>
          Keep delivering to reach the next tier. Your highest reached tier is settled after the {periodLabel} ends.
        </Text>
      ) : null}
    </View>
  );
}

function RecentChallengeCard({ challenge }: { challenge: RiderChallenge }) {
  const c = useColors();
  const payoutPaid = challenge.payoutStatus === "paid";
  const payoutPending = challenge.payoutStatus === "pending";
  const notEarned = challenge.payoutStatus === "not_earned";
  const progress = challenge.target > 0
    ? Math.min(100, Math.round((challenge.progress / challenge.target) * 100))
    : 0;
  const tone = payoutPaid ? "#15803d" : c.mutedForeground;
  const status = payoutPaid ? "Paid" : payoutPending ? "Bonus pending" : notEarned ? "No bonus" : "In progress";

  return (
    <View
      style={{
        backgroundColor: c.card,
        borderRadius: 20,
        padding: 16,
        borderWidth: 1,
        borderColor: c.border,
        gap: 14,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: payoutPaid ? "#dcfce7" : c.muted,
            }}
          >
            <Icon name={payoutPaid ? "check-circle" : "clock"} size={20} color={tone} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7 }}>
              <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 14 }}>
                {challenge.kind === "daily" ? "Daily challenge" : "Weekly challenge"}
              </Text>
              <View style={{ backgroundColor: payoutPaid ? "#dcfce7" : c.muted, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 }}>
                <Text style={{ color: tone, fontFamily: "Inter_700Bold", fontSize: 10 }}>{status}</Text>
              </View>
            </View>
            <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 4 }}>
              {formatChallengePeriod(challenge)} · {challenge.tier} · {challenge.target}-delivery target
            </Text>
          </View>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: tone, fontFamily: "Inter_700Bold", fontSize: 13 }}>
            {payoutPaid ? `+${rupees(challenge.bonusAmount)}` : notEarned ? "No bonus earned" : "Settlement pending"}
          </Text>
          <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 10, marginTop: 2 }}>
            {payoutPaid ? "Bonus paid" : payoutPending ? "Highest tier settling" : notEarned ? "No bonus earned" : "In progress"}
          </Text>
        </View>
      </View>

      <View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 7 }}>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: c.foreground }}>
            {challenge.periodDeliveries} eligible deliveries
          </Text>
          <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: c.mutedForeground }}>{progress}%</Text>
        </View>
        <View style={{ height: 8, borderRadius: 999, overflow: "hidden", backgroundColor: c.muted }}>
          <View style={{ width: `${progress}%`, height: "100%", borderRadius: 999, backgroundColor: tone }} />
        </View>
      </View>
    </View>
  );
}

function TransactionRow({ transaction }: { transaction: WalletTransaction }) {
  const c = useColors();
  const bonus = transaction.type !== "delivery";

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 13,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
      }}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 13,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: bonus ? "#fef3c7" : `${c.primary}14`,
        }}
      >
        <Icon name={bonus ? "zap" : "credit-card"} size={18} color={bonus ? "#b45309" : c.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }} numberOfLines={1}>
          {transaction.title}
        </Text>
        <Text style={{ marginTop: 2, color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 11 }}>
          {formatDate(transaction.createdAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
        </Text>
      </View>
      <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 14 }}>
        +{rupees(transaction.amount)}
      </Text>
    </View>
  );
}

export default function WalletScreen() {
  const c = useColors();
  const wallet = useGetRiderWallet({
    query: { queryKey: getGetRiderWalletQueryKey(), refetchInterval: 30_000 },
  });
  const data = wallet.data;
  const weekEndLabel = data
    ? new Date(new Date(data.weekEnd).getTime() - 1).toISOString()
    : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title="Wallet" subtitle="This week's earnings and challenges" />
      {wallet.isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
          <ActivityIndicator size="large" color={c.primary} />
          <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium" }}>Loading your wallet…</Text>
        </View>
      ) : wallet.isError || !data ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
          <View style={{ width: 52, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#fee2e2" }}>
            <Icon name="alert-circle" size={26} color="#b91c1c" />
          </View>
          <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 17 }}>Could not load Wallet</Text>
          <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 13, textAlign: "center" }}>
            Check your connection and try again.
          </Text>
          <Pressable
            onPress={() => wallet.refetch()}
            style={{ marginTop: 4, backgroundColor: c.primary, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 12 }}
          >
            <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 13 }}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 120, gap: 20 }}
          refreshControl={<RefreshControl refreshing={wallet.isRefetching} onRefresh={() => wallet.refetch()} tintColor={c.primary} />}
        >
          <View
            style={{
              backgroundColor: c.primary,
              padding: 20,
              borderRadius: 24,
              overflow: "hidden",
            }}
          >
            <Text style={{ color: "rgba(255,255,255,0.78)", fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
              {formatDate(data.weekStart, { day: "numeric", month: "short" })} – {weekEndLabel ? formatDate(weekEndLabel, { day: "numeric", month: "short" }) : "This week"}
            </Text>
            <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 32, marginTop: 6 }}>{rupees(data.totalEarnings)}</Text>
            <Text style={{ color: "rgba(255,255,255,0.78)", fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 3 }}>
              {data.deliveries} completed deliveries this week
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
              <View style={{ flex: 1, padding: 12, borderRadius: 16, backgroundColor: "rgba(0,0,0,0.12)" }}>
                <Text style={{ color: "rgba(255,255,255,0.72)", fontFamily: "Inter_600SemiBold", fontSize: 11 }}>Delivery earnings</Text>
                <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16, marginTop: 4 }}>{rupees(data.deliveryEarnings)}</Text>
              </View>
              <View style={{ flex: 1, padding: 12, borderRadius: 16, backgroundColor: "rgba(0,0,0,0.12)" }}>
                <Text style={{ color: "rgba(255,255,255,0.72)", fontFamily: "Inter_600SemiBold", fontSize: 11 }}>Bonuses</Text>
                <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16, marginTop: 4 }}>
                  {rupees(data.challengeBonuses + data.fastDeliveryBonuses)}
                </Text>
                <Text style={{ color: "rgba(255,255,255,0.66)", fontFamily: "Inter_500Medium", fontSize: 10, marginTop: 3 }}>
                  Challenges {rupees(data.challengeBonuses)} · Fast {rupees(data.fastDeliveryBonuses)}
                </Text>
              </View>
            </View>
          </View>

          <View style={{ gap: 10 }}>
            <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 18 }}>Active challenges</Text>
            <WalletChallengeCard challenge={data.todayChallenge} />
            <WalletChallengeCard challenge={data.weeklyChallenge} />
          </View>

          <View style={{ gap: 10 }}>
            <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 18 }}>Recent challenge results</Text>
            {data.recentChallenges.filter((challenge) => challenge.status !== "active").length === 0 ? (
              <View style={{ backgroundColor: c.card, padding: 24, borderRadius: 20, borderWidth: 1, borderStyle: "dashed", borderColor: c.border, alignItems: "center", gap: 8 }}>
                <Icon name="clock" size={28} color={c.mutedForeground} />
                <Text style={{ color: c.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>No recent challenge results</Text>
                <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12, textAlign: "center" }}>
                  Completed and expired challenges will appear here.
                </Text>
              </View>
            ) : (
              data.recentChallenges
                .filter((challenge) => challenge.status !== "active")
                .map((challenge) => <RecentChallengeCard key={challenge.id} challenge={challenge} />)
            )}
          </View>

          <View style={{ backgroundColor: c.card, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: c.border }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 16 }}>
              <Icon name="clock" size={18} color={c.primary} />
              <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 17 }}>This week's activity</Text>
            </View>
            {data.transactions.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 30, gap: 8 }}>
                <Icon name="credit-card" size={28} color={c.mutedForeground} />
                <Text style={{ color: c.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>No wallet activity yet</Text>
                <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12, textAlign: "center" }}>
                  Completed deliveries and earned bonuses will appear here.
                </Text>
              </View>
            ) : (
              data.transactions.map((transaction) => (
                <TransactionRow key={transaction.id} transaction={transaction} />
              ))
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}