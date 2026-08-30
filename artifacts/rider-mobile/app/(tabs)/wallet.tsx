import {
  getGetRiderWalletQueryKey,
  useGetRiderWallet,
  type RiderChallenge,
  type RiderChallengeMilestone,
  type RiderWallet,
  type RiderWeeklyEarnings,
  type WalletTransaction,
} from "@workspace/api-client-react";
import React from "react";
import { useLocalSearchParams } from "expo-router";
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
  const challengeWithScale = challenge as RiderChallenge & {
    milestoneScale?: RiderChallengeMilestone[];
    milestones?: RiderChallengeMilestone[];
  };
  const milestones = challengeWithScale.milestoneScale?.length
    ? challengeWithScale.milestoneScale
    : challengeWithScale.milestones;

  if (milestones?.length) {
    return milestones;
  }

  return [{
    target: challenge.target,
    reward: challenge.reward,
    earned: challenge.status === "completed" || challenge.progress >= challenge.target,
  }];
}

function getMilestoneThreshold(milestone: RiderChallengeMilestone) {
  return Number.isFinite(milestone.cumulativeTarget) && (milestone.cumulativeTarget ?? 0) > 0
    ? milestone.cumulativeTarget!
    : milestone.target;
}

function getCumulativeProgress(challenge: RiderChallenge) {
  if (Number.isFinite(challenge.cumulativeProgress)) {
    return Math.max(0, challenge.cumulativeProgress!);
  }
  if (Number.isFinite(challenge.periodDeliveries)) {
    return Math.max(0, challenge.periodDeliveries);
  }
  return Math.max(0, challenge.progress);
}

type WalletMilestoneFixtureScenario = "before" | "between" | "after";
function ChallengeMilestoneBar({
  milestones,
  progress,
  tone,
  kind,
}: {
  milestones: RiderChallengeMilestone[];
  progress: number;
  tone: string;
  kind: RiderChallenge["kind"];
}) {
  const c = useColors();
  const finalTarget = getMilestoneThreshold(
    milestones[milestones.length - 1] ?? { target: 0, reward: 0, earned: false },
  );
  const progressPercent = finalTarget > 0
    ? Math.min(100, Math.max(0, (progress / finalTarget) * 100))
    : 0;
  const currentMilestoneIndex = milestones.findIndex(
    (milestone) => progress < getMilestoneThreshold(milestone),
  );
  const milestonePositions = milestones.map((milestone) => {
    const threshold = getMilestoneThreshold(milestone);
    return finalTarget > 0
      ? Math.min(100, Math.max(0, (threshold / finalTarget) * 100))
      : 0;
  });
  const labelLanes: number[] = [];
  milestonePositions.forEach((position, index) => {
    let lane = 0;
    while (
      milestonePositions
        .slice(0, index)
        .some((previousPosition, previousIndex) =>
          labelLanes[previousIndex] === lane &&
          Math.abs(position - previousPosition) < 22,
        )
    ) {
      lane += 1;
    }
    labelLanes.push(lane);
  });
  const labelLaneCount = Math.max(1, ...labelLanes.map((lane) => lane + 1));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`Challenge progress: ${progress} of ${finalTarget} eligible deliveries`}
      accessibilityValue={{
        min: 0,
        max: finalTarget,
        now: Math.min(progress, finalTarget),
      }}
      style={{ paddingTop: 24, paddingBottom: 2 }}
      testID={`wallet-milestone-bar-${kind}`}
    >
      <View
        style={{
          height: 8,
          borderRadius: 999,
          backgroundColor: c.muted,
          marginHorizontal: 11,
          overflow: "visible",
        }}
      >
        <View
          style={{
            width: `${progressPercent}%`,
            height: "100%",
            borderRadius: 999,
            backgroundColor: tone,
          }}
        />
        {milestones.map((milestone, index) => {
          const threshold = getMilestoneThreshold(milestone);
          const position = milestonePositions[index];
          const reached = progress >= threshold;
          const current = index === currentMilestoneIndex;

          return (
            <View
              key={`${milestone.target}-${milestone.reward}-${index}`}
              accessibilityLabel={`${milestone.target}-delivery stage at ${threshold} cumulative deliveries, ${rupees(milestone.reward)} reward, ${reached ? "reached" : "upcoming"}`}
              style={{
                position: "absolute",
                left: `${position}%`,
                top: -7,
                width: 22,
                height: 22,
                marginLeft: -11,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  borderWidth: 2,
                  borderColor: current ? tone : c.card,
                  backgroundColor: reached ? tone : current ? c.card : c.muted,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon
                  name={reached ? "check" : "target"}
                  size={reached ? 13 : 11}
                  color={reached ? "#fff" : current ? tone : c.mutedForeground}
                />
              </View>
            </View>
          );
        })}
      </View>
      <View
        style={{
          position: "relative",
          height: labelLaneCount * 38,
          marginTop: 8,
          marginHorizontal: 11,
          overflow: "visible",
        }}
      >
        {milestones.map((milestone, index) => {
          const threshold = getMilestoneThreshold(milestone);
          const position = milestonePositions[index];
          const reached = progress >= threshold;

          return (
            <View
              key={`milestone-label-${milestone.target}-${milestone.reward}-${index}`}
              pointerEvents="none"
              testID={`wallet-milestone-label-${kind}-${index}`}
              style={{
                position: "absolute",
                left: `${position}%`,
                top: labelLanes[index] * 38,
                width: 50,
                height: 36,
                marginLeft: -25,
                alignItems: "center",
              }}
            >
              <Text
                testID={`wallet-milestone-text-${kind}-${index}-target`}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={{
                  width: "100%",
                  color: c.foreground,
                  fontFamily: "Inter_700Bold",
                  fontSize: 11,
                  lineHeight: 12,
                  textAlign: "center",
                }}
              >
                {milestone.target}
              </Text>
              {threshold !== milestone.target ? (
                <Text
                  testID={`wallet-milestone-text-${kind}-${index}-threshold`}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  style={{
                    width: "100%",
                    marginTop: 1,
                    color: c.mutedForeground,
                    fontFamily: "Inter_500Medium",
                    fontSize: 8,
                    lineHeight: 10,
                    textAlign: "center",
                  }}
                >
                  at {threshold}
                </Text>
              ) : null}
              <Text
                testID={`wallet-milestone-text-${kind}-${index}-reward`}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                style={{
                  width: "100%",
                  marginTop: 1,
                  color: reached ? c.successForeground : c.mutedForeground,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 9,
                  lineHeight: 11,
                  textAlign: "center",
                }}
              >
                {rupees(milestone.reward)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function WalletChallengeCard({ challenge }: { challenge: RiderChallenge }) {
  const c = useColors();
  const milestones = getChallengeMilestones(challenge);
  const payoutPaid = challenge.payoutStatus === "paid";
  const payoutPending = challenge.payoutStatus === "pending";
  const notEarned = challenge.payoutStatus === "not_earned";
  const expired = challenge.status === "expired";
  const periodInProgress = new Date(challenge.periodEnd).getTime() > Date.now();
  const cumulativeProgress = getCumulativeProgress(challenge);
  const nextMilestone = milestones.find(
    (milestone) => cumulativeProgress < getMilestoneThreshold(milestone),
  );
  const currentMilestone = nextMilestone;
  const highestReached = [...milestones]
    .reverse()
    .find((milestone) => cumulativeProgress >= getMilestoneThreshold(milestone));
  const finalTarget = getMilestoneThreshold(
    milestones[milestones.length - 1] ?? { target: challenge.target, reward: challenge.reward, earned: false },
  );
  const progress = finalTarget > 0
    ? Math.min(100, Math.round((cumulativeProgress / finalTarget) * 100))
    : 0;
  const remaining = currentMilestone
    ? Math.max(getMilestoneThreshold(currentMilestone) - cumulativeProgress, 0)
    : 0;
  const availableReward = Math.max(
    challenge.reward,
    ...milestones.map((milestone) => milestone.reward),
  );
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
      testID={`wallet-challenge-card-${challenge.kind}`}
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
              {challenge.tier} · {finalTarget}-delivery target
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
            Progress: {cumulativeProgress} / {finalTarget} deliveries
          </Text>
          <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: tone }}>{progress}%</Text>
        </View>
        <ChallengeMilestoneBar
          milestones={milestones}
          progress={cumulativeProgress}
          tone={tone}
          kind={challenge.kind}
        />
        <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 10 }}>
          {highestReached
            ? `Current reward tier: ${rupees(highestReached.reward)} at ${highestReached.target} deliveries`
            : currentMilestone
              ? `Next reward: ${rupees(currentMilestone.reward)} at ${getMilestoneThreshold(currentMilestone)} deliveries`
              : "No milestone reached yet"}
        </Text>
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12, flex: 1 }}>{endLabel}</Text>
        {periodInProgress && currentMilestone ? (
          <Text style={{ color: c.primary, fontFamily: "Inter_700Bold", fontSize: 12 }}>
            {remaining} rides to unlock {rupees(currentMilestone.reward)}
          </Text>
        ) : periodInProgress ? (
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
          Up to {rupees(availableReward)} extra bonus available
        </Text>
        <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 11, lineHeight: 16 }}>
          {challenge.periodDeliveries} eligible deliveries this {periodLabel} · only the highest tier reached is paid at period end.
        </Text>
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
  const milestones = getChallengeMilestones(challenge);
  const cumulativeProgress = getCumulativeProgress(challenge);
  const finalTarget = getMilestoneThreshold(
    milestones[milestones.length - 1] ?? { target: challenge.target, reward: challenge.reward, earned: false },
  );
  const progress = finalTarget > 0
    ? Math.min(100, Math.round((cumulativeProgress / finalTarget) * 100))
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
              {formatChallengePeriod(challenge)} · {challenge.tier} · {finalTarget}-delivery target
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
            {cumulativeProgress} eligible deliveries
          </Text>
          <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: c.mutedForeground }}>{progress}%</Text>
        </View>
        <ChallengeMilestoneBar
          milestones={milestones}
          progress={cumulativeProgress}
          tone={tone}
          kind={challenge.kind}
        />
      </View>
    </View>
  );
}

function PreviousWeekEarningsCard({ summary }: { summary?: RiderWeeklyEarnings }) {
  const c = useColors();
  if (!summary) return null;

  const weekEndLabel = formatDate(
    new Date(new Date(summary.weekEnd).getTime() - 1).toISOString(),
    { day: "numeric", month: "short" },
  );

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
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: c.accent,
            }}
          >
            <Icon name="clock" size={20} color={c.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 15 }}>
              Previous week's earnings
            </Text>
            <Text style={{ marginTop: 3, color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12 }}>
              {formatDate(summary.weekStart, { day: "numeric", month: "short" })} – {weekEndLabel}
            </Text>
          </View>
        </View>
        <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 20 }}>
          {rupees(summary.totalEarnings)}
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1, padding: 11, borderRadius: 14, backgroundColor: c.muted }}>
          <Text style={{ color: c.mutedForeground, fontFamily: "Inter_600SemiBold", fontSize: 10 }}>
            Deliveries
          </Text>
          <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 14, marginTop: 4 }}>
            {rupees(summary.deliveryEarnings)}
          </Text>
          <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 10, marginTop: 2 }}>
            {summary.deliveries} completed
          </Text>
        </View>
        <View style={{ flex: 1, padding: 11, borderRadius: 14, backgroundColor: c.muted }}>
          <Text style={{ color: c.mutedForeground, fontFamily: "Inter_600SemiBold", fontSize: 10 }}>
            Bonuses
          </Text>
          <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 14, marginTop: 4 }}>
            {rupees(summary.challengeBonuses + summary.fastDeliveryBonuses)}
          </Text>
          <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 10, marginTop: 2 }}>
            Challenges + fast delivery
          </Text>
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
  const { fixture } = useLocalSearchParams<{ fixture?: string }>();
  const fixtureScenario =
    __DEV__ && (fixture === "wallet-milestones" || fixture === "wallet-milestones-before")
      ? "before"
      : __DEV__ && fixture === "wallet-milestones-between"
        ? "between"
        : __DEV__ && fixture === "wallet-milestones-after"
          ? "after"
          : null;
  const wallet = useGetRiderWallet({
    query: {
      queryKey: getGetRiderWalletQueryKey(),
      refetchInterval: 30_000,
      enabled: !fixtureScenario,
    },
  });
  const data = fixtureScenario ? makeWalletMilestoneFixture(fixtureScenario) : wallet.data;
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

          {data.previousWeek ? <PreviousWeekEarningsCard summary={data.previousWeek} /> : null}

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

function makeFixtureChallenge(
  kind: RiderChallenge["kind"],
  scenario: WalletMilestoneFixtureScenario,
): RiderChallenge {
  const milestones = WALLET_FIXTURE_MILESTONES[kind];
  const progress = fixtureProgress(kind, scenario);
  const finalMilestone = milestones[milestones.length - 1];
  return {
    id: `fixture-${kind}`,
    kind,
    tier: kind === "daily" ? "Gold" : "Platinum",
    target: finalMilestone.target,
    progress,
    reward: finalMilestone.reward,
    milestones,
    milestoneScale: milestones,
    cumulativeProgress: progress,
    status: "active",
    payoutStatus: "in_progress",
    bonusAmount: 0,
    periodDeliveries: progress,
    periodStart: WALLET_FIXTURE_PERIOD_START,
    periodEnd: WALLET_FIXTURE_PERIOD_END,
  };
}

const WALLET_FIXTURE_MILESTONES: Record<
  RiderChallenge["kind"],
  RiderChallengeMilestone[]
> = {
  daily: [
    { target: 10, cumulativeTarget: 10, reward: 200, earned: false },
    { target: 15, cumulativeTarget: 15, reward: 300, earned: false },
    { target: 20, cumulativeTarget: 20, reward: 400, earned: false },
    { target: 25, cumulativeTarget: 25, reward: 500, earned: false },
    { target: 30, cumulativeTarget: 30, reward: 600, earned: false },
  ],
  weekly: [
    { target: 50, cumulativeTarget: 50, reward: 500, earned: false },
    { target: 75, cumulativeTarget: 75, reward: 1000, earned: false },
    { target: 100, cumulativeTarget: 100, reward: 1500, earned: false },
    { target: 125, cumulativeTarget: 125, reward: 1800, earned: false },
    { target: 150, cumulativeTarget: 150, reward: 2000, earned: false },
  ],
};

function fixtureProgress(
  kind: RiderChallenge["kind"],
  scenario: WalletMilestoneFixtureScenario,
) {
  if (kind === "daily") {
    if (scenario === "before") return 4;
    if (scenario === "between") return 17;
    return 27;
  }
  if (scenario === "before") return 20;
  if (scenario === "between") return 90;
  return 135;
}

function makeWalletMilestoneFixture(scenario: WalletMilestoneFixtureScenario): RiderWallet {
  return {
    weekStart: WALLET_FIXTURE_PERIOD_START,
    weekEnd: WALLET_FIXTURE_PERIOD_END,
    previousWeek: {
      weekStart: "2098-12-25T00:00:00.000Z",
      weekEnd: WALLET_FIXTURE_PERIOD_START,
      deliveryEarnings: 0,
      challengeBonuses: 0,
      fastDeliveryBonuses: 0,
      totalEarnings: 0,
      deliveries: 0,
    },
    deliveryEarnings: 0,
    challengeBonuses: 0,
    fastDeliveryBonuses: 0,
    totalEarnings: 0,
    deliveries: 0,
    transactions: [],
    todayChallenge: makeFixtureChallenge("daily", scenario),
    weeklyChallenge: makeFixtureChallenge("weekly", scenario),
    recentChallenges: [],
  };
}

const WALLET_FIXTURE_PERIOD_START = "2099-01-01T00:00:00.000Z";

const WALLET_FIXTURE_PERIOD_END = "2099-01-08T00:00:00.000Z";
