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
  const allMilestonesEarned = milestones.every((milestone) => milestone.earned);
  const completed = challenge.status === "completed" || allMilestonesEarned;
  const expired = challenge.status === "expired";
  const progress = challenge.target > 0
    ? Math.min(100, Math.round((challenge.progress / challenge.target) * 100))
    : 0;
  const nextMilestone = milestones.find((milestone) => !milestone.earned);
  const remaining = nextMilestone ? Math.max(nextMilestone.target - challenge.progress, 0) : 0;
  const tone = completed ? c.successForeground : expired ? c.mutedForeground : c.primary;
  const label = challenge.kind === "daily" ? "Today's challenge" : "Weekly challenge";
  const endLabel = challenge.kind === "daily"
    ? "Ends today"
    : `Ends ${formatDate(new Date(new Date(challenge.periodEnd).getTime() - 1).toISOString(), { weekday: "short", day: "numeric", month: "short" })}`;

  return (
    <View
      style={{
        backgroundColor: c.card,
        borderRadius: 20,
        padding: 16,
        borderWidth: 1,
        borderColor: completed ? c.successBg : c.border,
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
              backgroundColor: completed ? c.successBg : c.accent,
            }}
          >
            <Icon name={challenge.kind === "daily" ? "zap" : "target"} size={20} color={tone} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: c.foreground }}>
              {label}
            </Text>
            <Text style={{ marginTop: 2, fontFamily: "Inter_500Medium", fontSize: 12, color: c.mutedForeground }}>
              {challenge.tier} tier · {milestones.length} reward {milestones.length === 1 ? "goal" : "goals"}
            </Text>
          </View>
        </View>
        <View
          style={{
            backgroundColor: completed ? c.successBg : expired ? c.muted : c.accent,
            paddingHorizontal: 9,
            paddingVertical: 5,
            borderRadius: 999,
          }}
        >
          <Text style={{ color: tone, fontFamily: "Inter_700Bold", fontSize: 11 }}>
            {completed ? "All rewards earned" : expired ? "Expired" : `${milestones.filter((milestone) => milestone.earned).length} earned`}
          </Text>
        </View>
      </View>

      <View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 7 }}>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: c.foreground }}>
            Current progress: {challenge.progress} deliveries
          </Text>
          <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: tone }}>{progress}%</Text>
        </View>
        <View style={{ height: 8, borderRadius: 999, overflow: "hidden", backgroundColor: c.muted }}>
          <View style={{ width: `${progress}%`, height: "100%", borderRadius: 999, backgroundColor: tone }} />
        </View>
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12, flex: 1 }}>{endLabel}</Text>
        {nextMilestone ? (
          <Text style={{ color: expired ? c.mutedForeground : c.primary, fontFamily: "Inter_700Bold", fontSize: 12 }}>
            Next: {nextMilestone.target} deliveries
          </Text>
        ) : (
          <Text style={{ color: c.successForeground, fontFamily: "Inter_700Bold", fontSize: 12 }}>All goals reached</Text>
        )}
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 13 }}>Reward goals</Text>
        {milestones.map((milestone, index) => {
          const earned = milestone.earned;
          return (
            <View
              key={`${milestone.target}-${milestone.reward}-${index}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                padding: 11,
                borderRadius: 12,
                backgroundColor: earned ? c.successBg : c.muted,
              }}
            >
              <Icon name={earned ? "check-circle" : "target"} size={18} color={earned ? c.successForeground : c.mutedForeground} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.foreground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                  {milestone.target} deliveries
                </Text>
                <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 11, marginTop: 2 }}>
                  Goal {index + 1} · {earned ? "Earned" : "Upcoming"}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ color: earned ? c.successForeground : c.foreground, fontFamily: "Inter_700Bold", fontSize: 13 }}>
                  +{rupees(milestone.reward)}
                </Text>
                {!earned && milestone === nextMilestone ? (
                  <Text style={{ color: c.primary, fontFamily: "Inter_600SemiBold", fontSize: 10, marginTop: 2 }}>
                    {remaining} to go
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function RecentChallengeCard({ challenge }: { challenge: RiderChallenge }) {
  const c = useColors();
  const completed = challenge.status === "completed";
  const earnedReward = getChallengeMilestones(challenge)
    .filter((milestone) => milestone.earned)
    .reduce((total, milestone) => total + milestone.reward, 0);
  const progress = challenge.target > 0
    ? Math.min(100, Math.round((challenge.progress / challenge.target) * 100))
    : 0;
  const tone = completed ? "#15803d" : c.mutedForeground;
  const status = completed ? "Completed" : "Expired";

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
              backgroundColor: completed ? "#dcfce7" : c.muted,
            }}
          >
            <Icon name={completed ? "check-circle" : "clock"} size={20} color={tone} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7 }}>
              <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 14 }}>
                {challenge.kind === "daily" ? "Daily challenge" : "Weekly challenge"}
              </Text>
              <View style={{ backgroundColor: completed ? "#dcfce7" : c.muted, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 }}>
                <Text style={{ color: tone, fontFamily: "Inter_700Bold", fontSize: 10 }}>{status}</Text>
              </View>
            </View>
            <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 4 }}>
              {formatChallengePeriod(challenge)} · {challenge.tier} tier
            </Text>
          </View>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: tone, fontFamily: "Inter_700Bold", fontSize: 13 }}>
            {completed ? `+${rupees(earnedReward)}` : rupees(challenge.reward)}
          </Text>
          <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 10, marginTop: 2 }}>
            {completed ? "Reward earned" : "Reward not earned"}
          </Text>
        </View>
      </View>

      <View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 7 }}>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: c.foreground }}>
            {challenge.progress} / {challenge.target} deliveries
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