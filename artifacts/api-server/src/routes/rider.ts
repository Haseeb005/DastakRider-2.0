import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { ObjectId } from "mongodb";
import {
  usersCol,
  ordersCol,
  reviewsCol,
  chatsCol,
  riderChallengesCol,
  riderWalletEntriesCol,
} from "../lib/mongo";
import { getHeatmapSnapshot } from "../lib/heatmapService";
import { signRiderToken, verifyRiderToken } from "../lib/riderToken";

const router = Router();

// ---------------------------------------------------------------------------
// Bearer-token auth (additive — for the Expo mobile app).
// Web clients keep using the existing session cookie. Mobile clients cannot
// rely on cookies, so login/register also return an HMAC-signed token that
// encodes the riderId. The token is verified on each request as a fallback
// when no session riderId is present. No DB writes — purely stateless.
// ---------------------------------------------------------------------------
function bearerRiderId(req: any): string {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (typeof h !== "string" || !h.toLowerCase().startsWith("bearer ")) return "";
  const token = h.slice(7).trim();
  if (!token) return "";
  return verifyRiderToken(token) || "";
}

// Real order status flow in the Dastak database:
//   Pending -> Admin Accepted -> Rider Accepted -> Rider Picked Up -> Delivered  (or Rejected)
// An order only becomes visible to riders once the admin has accepted it
// ("Admin Accepted"). That is the trigger for the available list + new-order alert.
const ACTIVE_STATUSES = ["Rider Accepted", "Rider Picked Up"];
const AVAILABLE_STATUS = "Admin Accepted";
const DELIVERED_STATUS = "Delivered";
const COD_TYPES = ["COD", "Cash", "cash", "cod"];

function normPhone(phone: any): string {
  return String(phone).replace(/[\s\-()]/g, "");
}

// Passwords in the legacy DB are mostly plaintext, a few are bcrypt-hashed.
async function checkPassword(input: string, stored: any): Promise<boolean> {
  if (typeof stored !== "string" || stored.length === 0) return false;
  if (stored.startsWith("$2")) {
    try {
      return await bcrypt.compare(input, stored);
    } catch {
      return false;
    }
  }
  return input === stored;
}

function isDeleted(user: any): boolean {
  return user?.deleted === true || user?.deleted === "true";
}

function getRiderId(req: any): string {
  return (req.session as any)?.riderId || bearerRiderId(req) || "";
}

function requireRiderId(req: any, res: any): string | null {
  const id = getRiderId(req);
  if (!id) {
    res.status(401).json({ message: "Rider not logged in" });
    return null;
  }
  return id;
}

async function findRiderById(id: string) {
  let _id: ObjectId;
  try {
    _id = new ObjectId(id);
  } catch {
    return null;
  }
  return usersCol().findOne({ _id, type: "rider" });
}

async function riderRating(user: any): Promise<{ rating: number; ratingCount: number }> {
  try {
    const riderId = String(user?._id);
    const reviews = await reviewsCol()
      .find({ riderId, type: "delivery" } as any)
      .toArray();
    const ratingCount = reviews.length;
    const rating =
      ratingCount > 0
        ? reviews.reduce((sum: number, r: any) => sum + (Number(r.riderRating) || 0), 0) /
          ratingCount
        : 0;
    return { rating: Math.round(rating * 10) / 10, ratingCount };
  } catch {
    return { rating: 0, ratingCount: 0 };
  }
}

async function safeRider(user: any) {
  const { rating, ratingCount } = await riderRating(user);
  return {
    id: String(user._id),
    name: user.name || null,
    phone: user.phone || null,
    city: user.city || null,
    vehicleType: user.vehicleType || "bike",
    isOnline: !!user.isOnline,
    totalEarnings: 0,
    totalDeliveries: 0,
    rating,
    ratingCount,
    riderZones: Array.isArray(user.riderZones) ? user.riderZones.filter(Boolean) : [],
    pendingCollection: Number(user.pendingCollection) || 0,
    unpaidCollection: Number(user.unpaidCollection) || 0,
    paymentLimit: Number(user.paymentLimit) || 0,
    tillNoonFare: Number(user.tillNoonFare) || 0,
  };
}

// ── Pakistan timezone helpers (UTC+5) ──────────────────────────────────────────
// Start-of-period returned as a real UTC instant aligned to the PKT calendar, so
// comparisons against stored timestamps are correct for PK.
// NOTE: period filtering uses `createdAt`, NOT `updatedAt` — every delivered order
// in the shared prod DB shares one bulk-written `updatedAt`, so filtering on it
// puts everything in "today" and makes Today/Week/Month all equal the overall total.
const PKT_MS = 5 * 60 * 60 * 1000;
const PKT_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the start of the current cash-collection window as a UTC Date.
 * The window boundary is 8:00 AM PKT (UTC+5) each day.
 *   • If it is currently ≥ 8:00 AM PKT → today's 8:00 AM PKT.
 *   • If it is currently < 8:00 AM PKT → yesterday's 8:00 AM PKT.
 * Any COD order with paidToRider:false and createdAt before this cutoff
 * is "stale" and must be cleared before the rider can accept new orders.
 */
function pkt8AMCutoff(): Date {
  const nowMs = Date.now();
  const shifted = new Date(nowMs + PKT_MS); // PKT wall clock via UTC getters
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  // PKT midnight of today as UTC instant, then +8 h = today's 8 AM PKT.
  const today8AM = new Date(Date.UTC(y, m, d) - PKT_MS + 8 * 60 * 60 * 1000);
  return nowMs >= today8AM.getTime()
    ? today8AM
    : new Date(today8AM.getTime() - 24 * 60 * 60 * 1000); // step back one day
}

function pktPeriodStartAt(kind: "day" | "week" | "month", reference = new Date()): Date {
  const shifted = new Date(reference.getTime() + PKT_MS); // read PKT wall clock via UTC getters
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  const dow = shifted.getUTCDay(); // 0=Sun..6=Sat
  let day = d;
  if (kind === "week") {
    // Rider week runs Saturday -> Friday, not the JS default Sunday -> Saturday.
    const daysSinceSaturday = (dow - 6 + 7) % 7;
    day = d - daysSinceSaturday;
  }
  if (kind === "month") day = 1;
  // PKT midnight of that calendar date == that UTC midnight minus 5h.
  return new Date(Date.UTC(y, m, day) - PKT_MS);
}

function pktPeriodStart(kind: "day" | "week" | "month"): Date {
  return pktPeriodStartAt(kind);
}

function pktDateKey(value: Date): string {
  const shifted = new Date(value.getTime() + PKT_MS);
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Converts an ISO calendar date to PKT midnight as a real UTC instant.
 * Date strings are validated strictly so an invalid value never silently shifts
 * to a different calendar day.
 */
function pktDateStart(dateValue: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    return null;
  }

  return new Date(utcDate.getTime() - PKT_MS);
}

type ChallengeKind = "daily" | "weekly";

type ChallengeMilestone = {
  target: number;
  reward: number;
};

type ChallengePayoutStatus = "in_progress" | "pending" | "paid" | "not_earned";

const CHALLENGE_MILESTONES: Record<ChallengeKind, ChallengeMilestone[]> = {
  daily: [
    { target: 10, reward: 200 },
    { target: 15, reward: 200 },
    { target: 20, reward: 500 },
    { target: 25, reward: 800 },
    { target: 30, reward: 1000 },
  ],
  weekly: [
    { target: 50, reward: 500 },
    { target: 75, reward: 1000 },
    { target: 100, reward: 2000 },
  ],
};

const RETIRED_DAILY_MILESTONES: ChallengeMilestone[] = [
  { target: 10, reward: 200 },
  { target: 15, reward: 200 },
  { target: 20, reward: 500 },
  { target: 25, reward: 800 },
  { target: 30, reward: 800 },
  { target: 35, reward: 800 },
  { target: 40, reward: 800 },
];

// Order records normally settle immediately. A bounded window catches delayed
// shared-system writes around a daily/weekly boundary without repeatedly
// recounting every unsuccessful historical challenge on each Wallet refresh.
const CHALLENGE_SETTLEMENT_GRACE_MS = PKT_DAY_MS;
const FAST_DELIVERY_WINDOW_MS = 20 * 60 * 1000;
const FAST_DELIVERY_BONUS = 50;
const DELIVERY_GEOFENCE_RADIUS_METERS = 20;

let walletIndexesPromise: Promise<void> | null = null;

function ensureWalletIndexes(): Promise<void> {
  if (!walletIndexesPromise) {
    walletIndexesPromise = (async () => {
      const challenges = riderChallengesCol();
      await Promise.all([
        challenges.createIndex(
          { riderId: 1, kind: 1, periodKey: 1 },
          { unique: true, name: "riderId_1_kind_1_periodKey_1" },
        ),
        challenges.createIndex(
          { riderId: 1, kind: 1, basePeriodKey: 1, sequence: 1 },
          { name: "rider_challenge_sequence_lookup" },
        ),
        challenges.createIndex({ riderId: 1, periodEnd: -1 }),
        challenges.createIndex({
          riderId: 1,
          kind: 1,
          status: 1,
          settlementGraceUntil: 1,
        }),
        riderWalletEntriesCol().createIndex({ challengeKey: 1 }, { unique: true }),
        riderWalletEntriesCol().createIndex({ entryKey: 1 }, { unique: true, sparse: true }),
        riderWalletEntriesCol().createIndex({ riderId: 1, weekKey: 1, createdAt: -1 }),
      ]);
    })();
  }
  return walletIndexesPromise;
}

function challengePeriod(kind: ChallengeKind, now = new Date()) {
  const start = pktPeriodStartAt(kind === "daily" ? "day" : "week", now);
  const duration = kind === "daily" ? PKT_DAY_MS : 7 * PKT_DAY_MS;
  const end = new Date(start.getTime() + duration);
  const weekStart = pktPeriodStartAt("week", start);
  return {
    start,
    end,
    periodKey: pktDateKey(start),
    weekKey: pktDateKey(weekStart),
    duration,
  };
}

function milestoneTemplate(kind: ChallengeKind): ChallengeMilestone[] {
  return CHALLENGE_MILESTONES[kind].map((milestone) => ({ ...milestone }));
}

const SEQUENTIAL_CHALLENGE_MODE = "sequential";

function isSequentialChallenge(challenge: any): boolean {
  return (
    challenge?.challengeMode === SEQUENTIAL_CHALLENGE_MODE &&
    Number.isInteger(Number(challenge?.sequence)) &&
    Number(challenge.sequence) >= 0
  );
}

function sequentialTierLabel(kind: ChallengeKind, sequence: number): string {
  return `Challenge ${sequence + 1} of ${CHALLENGE_MILESTONES[kind].length}`;
}

function cumulativeTargetForSequence(kind: ChallengeKind, sequence: number): number {
  return CHALLENGE_MILESTONES[kind]
    .slice(0, sequence + 1)
    .reduce((total, milestone) => total + milestone.target, 0);
}

function highestCompletedSequence(kind: ChallengeKind, deliveredCount: number): number {
  return CHALLENGE_MILESTONES[kind].reduce(
    (highest, _milestone, sequence) =>
      deliveredCount >= cumulativeTargetForSequence(kind, sequence) ? sequence : highest,
    -1,
  );
}

function hasMilestoneDefinition(challenge: any): boolean {
  return (
    Array.isArray(challenge?.milestones) &&
    challenge.milestones.length > 0 &&
    challenge.milestones.every(
      (milestone: any) =>
        Number.isFinite(Number(milestone?.target)) &&
        Number(milestone.target) > 0 &&
        Number.isFinite(Number(milestone?.reward)),
    )
  );
}

function hasCurrentMilestoneSchedule(challenge: any): boolean {
  if (!hasMilestoneDefinition(challenge)) return false;
  const expected = CHALLENGE_MILESTONES[challenge.kind as ChallengeKind];
  if (!expected) return false;
  const actual = milestonesForChallenge(challenge);
  return (
    actual.length === expected.length &&
    actual.every(
      (milestone, index) =>
        milestone.target === expected[index].target &&
        milestone.reward === expected[index].reward,
    )
  );
}

function hasRetiredDailyMilestoneSchedule(challenge: any): boolean {
  if (!hasMilestoneDefinition(challenge) || challenge.kind !== "daily") return false;
  const actual = milestonesForChallenge(challenge);
  return (
    actual.length === RETIRED_DAILY_MILESTONES.length &&
    actual.every(
      (milestone, index) =>
        milestone.target === RETIRED_DAILY_MILESTONES[index].target &&
        milestone.reward === RETIRED_DAILY_MILESTONES[index].reward,
    )
  );
}

function milestonesForChallenge(challenge: any): ChallengeMilestone[] {
  if (hasMilestoneDefinition(challenge)) {
    return challenge.milestones
      .map((milestone: any) => ({
        target: Number(milestone.target),
        reward: Number(milestone.reward),
      }))
      .sort((a: ChallengeMilestone, b: ChallengeMilestone) => a.target - b.target);
  }

  // Completed and historical records created before the milestone rollout keep
  // their original one-time reward rather than being retroactively reconfigured.
  return [{ target: Number(challenge?.target) || 0, reward: Number(challenge?.reward) || 0 }]
    .filter((milestone) => milestone.target > 0);
}

function challengeTierLabel(kind: ChallengeKind): string {
  return kind === "daily" ? "Daily delivery goals" : "Weekly fuel bonus";
}

function milestoneTitle(challenge: any, goalNumber: number, milestone: ChallengeMilestone): string {
  const label = challenge.kind === "daily" ? "Daily challenge" : "Weekly challenge";
  return `${label} · Goal #${goalNumber} (${milestone.target} deliveries)`;
}

function legacyChallengeTitle(challenge: any): string {
  const label = challenge.kind === "daily" ? "Today's Challenge" : "Weekly Challenge";
  return `${label} · ${challenge.tier || challengeTierLabel(challenge.kind)}`;
}

function walletChallengeResponse(
  challenge: any,
  payoutAmount = 0,
  reference = new Date(),
) {
  const milestones = milestonesForChallenge(challenge);
  const settledTargets = new Set(
    Array.isArray(challenge.earnedMilestoneTargets)
      ? challenge.earnedMilestoneTargets.map((target: unknown) => Number(target))
      : [],
  );
  const isLegacyCompleted = !hasMilestoneDefinition(challenge) && challenge.status === "completed";
  const finalMilestone = milestones.at(-1) ?? { target: 0, reward: 0 };
  const periodEnded = new Date(challenge.periodEnd) <= reference;
  const targetReached =
    challenge.status === "completed" ||
    Number(challenge.progress) >= finalMilestone.target;
  const normalizedPayoutAmount = Math.max(0, Number(payoutAmount) || 0);
  const payoutStatus: ChallengePayoutStatus =
    normalizedPayoutAmount > 0
      ? "paid"
      : !periodEnded
        ? targetReached
          ? "pending"
          : "in_progress"
        : "not_earned";
  const periodDeliveries = Math.max(
    0,
    Number.isFinite(Number(challenge.periodDeliveries))
      ? Number(challenge.periodDeliveries)
      : isSequentialChallenge(challenge)
        ? (Number(challenge.deliveryBaseline) || 0) + (Number(challenge.progress) || 0)
        : Number(challenge.progress) || 0,
  );

  return {
    id: String(challenge._id),
    kind: challenge.kind,
    tier: challenge.tier || challengeTierLabel(challenge.kind),
    target: finalMilestone.target,
    progress: Number(challenge.progress) || 0,
    reward: finalMilestone.reward,
    milestones: milestones.map((milestone) => ({
      target: milestone.target,
      reward: milestone.reward,
      earned:
        isLegacyCompleted ||
        settledTargets.has(milestone.target) ||
        (isSequentialChallenge(challenge) &&
          challenge.status === "completed" &&
          milestone.target === finalMilestone.target),
    })),
    status: challenge.status,
    payoutStatus,
    bonusAmount: payoutStatus === "paid" ? normalizedPayoutAmount : 0,
    periodDeliveries,
    periodStart: new Date(challenge.periodStart).toISOString(),
    periodEnd: new Date(challenge.periodEnd).toISOString(),
  };
}

function legacyChallengePayoutKeys(challenge: any): string[] {
  const kind = challenge.kind as ChallengeKind;
  const riderId = String(challenge.riderId);
  const periodKey = String(challenge.periodKey || "");
  const basePeriodKey = String(challenge.basePeriodKey || periodKey);
  return Array.from(
    new Set(
      [
        challenge.payoutKey ? String(challenge.payoutKey) : "",
        `${riderId}:${kind}:${periodKey}`,
        `${riderId}:${kind}:${basePeriodKey}`,
        `${riderId}:${kind}:${basePeriodKey}:highest`,
        ...milestonesForChallenge(challenge).flatMap((milestone) => [
          `${riderId}:${kind}:${periodKey}:milestone:${milestone.target}`,
          `${riderId}:${kind}:${basePeriodKey}:milestone:${milestone.target}`,
        ]),
      ].filter(Boolean),
    ),
  );
}

async function countChallengeDeliveries(challenge: any): Promise<number> {
  const periodRange = {
    $gte: new Date(challenge.periodStart),
    $lt: new Date(challenge.periodEnd),
  };
  return ordersCol().countDocuments({
    riderId: challenge.riderId,
    status: DELIVERED_STATUS,
    $or: [
      { riderDeliveredAt: periodRange },
      {
        riderDeliveredAt: null,
        createdAt: periodRange,
      },
    ],
  });
}

async function createSequentialChallenge(
  riderId: string,
  kind: ChallengeKind,
  period: ReturnType<typeof challengePeriod>,
  sequence: number,
  deliveryBaseline: number,
  now: Date,
): Promise<any> {
  const milestone = CHALLENGE_MILESTONES[kind][sequence];
  if (!milestone) throw new Error(`No ${kind} challenge exists at sequence ${sequence}`);

  const challenges = riderChallengesCol();
  const storagePeriodKey =
    sequence === 0 ? period.periodKey : `${period.periodKey}:sequence:${sequence}`;
  const challenge = {
    riderId,
    kind,
    challengeMode: SEQUENTIAL_CHALLENGE_MODE,
    sequence,
    periodKey: storagePeriodKey,
    basePeriodKey: period.periodKey,
    weekKey: period.weekKey,
    periodStart: period.start,
    periodEnd: period.end,
    settlementGraceUntil: new Date(
      period.end.getTime() + CHALLENGE_SETTLEMENT_GRACE_MS,
    ),
    deliveryBaseline: Math.max(0, deliveryBaseline),
    tier: sequentialTierLabel(kind, sequence),
    target: milestone.target,
    reward: milestone.reward,
    milestones: [{ ...milestone }],
    earnedMilestoneTargets: [],
    progress: 0,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  try {
    await challenges.updateOne(
      {
        riderId,
        kind,
        periodKey: storagePeriodKey,
      },
      { $setOnInsert: challenge },
      { upsert: true },
    );
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
  }

  const created = await challenges.findOne({
    riderId,
    kind,
    periodKey: storagePeriodKey,
  });
  if (!created) throw new Error("Could not create rider challenge");
  return created;
}

async function migrateCurrentChallenge(
  challenge: any,
  now: Date,
): Promise<any> {
  const challenges = riderChallengesCol();
  const lockToken = new ObjectId().toHexString();
  const lockUntil = new Date(Date.now() + 15_000);
  let lockedChallenge: any = null;

  // Conversion must happen before legacy progress reconciliation. Otherwise a
  // rider with surplus deliveries can be paid under the retired cumulative
  // thresholds while two Wallet requests are racing the migration.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const lock = await challenges.updateOne(
      {
        _id: challenge._id,
        challengeMode: { $ne: SEQUENTIAL_CHALLENGE_MODE },
        $or: [
          { "settlementLock.until": { $exists: false } },
          { "settlementLock.until": { $lte: new Date() } },
        ],
      },
      { $set: { settlementLock: { token: lockToken, until: lockUntil } } },
    );

    if (lock.modifiedCount === 1) {
      lockedChallenge = await challenges.findOne({
        _id: challenge._id,
        "settlementLock.token": lockToken,
      });
      break;
    }

    const current = await challenges.findOne({ _id: challenge._id });
    if (!current) throw new Error("Rider challenge no longer exists");
    if (isSequentialChallenge(current)) return current;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!lockedChallenge) throw new Error("Rider challenge migration is busy");

  const ownershipFilter = {
    _id: lockedChallenge._id,
    "settlementLock.token": lockToken,
  };

  try {
    const kind = lockedChallenge.kind as ChallengeKind;
    const schedule = CHALLENGE_MILESTONES[kind];
    const existingEntries = await riderWalletEntriesCol()
      .find({
        riderId: lockedChallenge.riderId,
        type: "challenge_bonus",
        $or: [
          { challengeId: String(lockedChallenge._id) },
          {
            challengeKey: {
              $in: [
                `${lockedChallenge.riderId}:${kind}:${lockedChallenge.periodKey}`,
                ...schedule.map(
                  (milestone) =>
                    `${lockedChallenge.riderId}:${kind}:${lockedChallenge.periodKey}:milestone:${milestone.target}`,
                ),
              ],
            },
          },
        ],
      })
      .toArray();
    const earnedTargets = new Set<number>(
      Array.isArray(lockedChallenge.earnedMilestoneTargets)
        ? lockedChallenge.earnedMilestoneTargets.map((target: unknown) => Number(target))
        : [],
    );
    for (const entry of existingEntries) {
      const entryTarget = Number(entry.milestoneTarget);
      if (Number.isFinite(entryTarget)) earnedTargets.add(entryTarget);
    }

    let completedSequence = schedule.reduce(
      (latest, milestone, index) => earnedTargets.has(milestone.target) ? index : latest,
      -1,
    );
    if (completedSequence < 0 && lockedChallenge.status === "completed") {
      const legacyTarget = Number(lockedChallenge.target) || 0;
      completedSequence = schedule.findIndex((milestone) => milestone.target === legacyTarget);
      if (completedSequence < 0 && legacyTarget >= schedule.at(-1)!.target) {
        completedSequence = schedule.length - 1;
      }
      if (completedSequence >= 0) {
        earnedTargets.add(schedule[completedSequence].target);
      }
    }

    const deliveredCount = await countChallengeDeliveries(lockedChallenge);
    if (completedSequence >= 0) {
      // Preserve every reward already marked as earned, but do not discover any
      // new legacy milestone from deliveredCount during conversion.
      for (const [index, milestone] of schedule.entries()) {
        if (!earnedTargets.has(milestone.target)) continue;
        const existingEntry = existingEntries.find(
          (entry) => Number(entry.milestoneTarget) === milestone.target,
        );
        const challengeKey =
          existingEntry?.challengeKey ||
          (hasMilestoneDefinition(lockedChallenge)
            ? `${lockedChallenge.riderId}:${kind}:${lockedChallenge.periodKey}:milestone:${milestone.target}`
            : `${lockedChallenge.riderId}:${kind}:${lockedChallenge.periodKey}`);
        await riderWalletEntriesCol().updateOne(
          { challengeKey },
          {
            $setOnInsert: {
              riderId: lockedChallenge.riderId,
              challengeKey,
              challengeId: String(lockedChallenge._id),
              weekKey: lockedChallenge.weekKey,
              milestoneTarget: milestone.target,
              challengeSequence: index,
              type: "challenge_bonus",
              amount: milestone.reward,
              title: milestoneTitle(lockedChallenge, index + 1, milestone),
              createdAt: lockedChallenge.completedAt || now,
            },
          },
          { upsert: true },
        );
      }

      const milestone = schedule[completedSequence];
      const matchingEntry = existingEntries.find(
        (entry) => Number(entry.milestoneTarget) === milestone.target,
      );
      const payoutKey =
        matchingEntry?.challengeKey ||
        (hasMilestoneDefinition(lockedChallenge)
          ? `${lockedChallenge.riderId}:${kind}:${lockedChallenge.periodKey}:milestone:${milestone.target}`
          : `${lockedChallenge.riderId}:${kind}:${lockedChallenge.periodKey}`);
      await challenges.updateOne(
        ownershipFilter,
        {
          $set: {
            challengeMode: SEQUENTIAL_CHALLENGE_MODE,
            sequence: completedSequence,
            basePeriodKey: String(lockedChallenge.basePeriodKey || lockedChallenge.periodKey),
            // Old cumulative rewards are preserved, then the next challenge
            // starts at migration time rather than granting surplus thresholds.
            deliveryBaseline: Math.max(0, deliveredCount - milestone.target),
            tier: sequentialTierLabel(kind, completedSequence),
            target: milestone.target,
            reward: milestone.reward,
            milestones: [{ ...milestone }],
            earnedMilestoneTargets: [milestone.target],
            progress: milestone.target,
            status: "completed",
            completedAt: lockedChallenge.completedAt || now,
            payoutKey,
            migratedAt: now,
            updatedAt: now,
          },
        },
      );
    } else {
      const firstMilestone = schedule[0];
      await challenges.updateOne(
        ownershipFilter,
        {
          $set: {
            challengeMode: SEQUENTIAL_CHALLENGE_MODE,
            sequence: 0,
            basePeriodKey: String(lockedChallenge.basePeriodKey || lockedChallenge.periodKey),
            deliveryBaseline: 0,
            tier: sequentialTierLabel(kind, 0),
            target: firstMilestone.target,
            reward: firstMilestone.reward,
            milestones: [{ ...firstMilestone }],
            earnedMilestoneTargets: [],
            progress: deliveredCount,
            status: "active",
            migratedAt: now,
            updatedAt: now,
          },
          $unset: { completedAt: "", payoutKey: "" },
        },
      );
    }

    const migrated = await challenges.findOne({ _id: lockedChallenge._id });
    if (!migrated) throw new Error("Could not migrate rider challenge");
    return migrated;
  } finally {
    await challenges.updateOne(ownershipFilter, { $unset: { settlementLock: "" } });
  }
}

async function advanceSequentialChallenge(
  challenge: any,
  now: Date,
): Promise<any> {
  let current = challenge;
  const maxSteps = CHALLENGE_MILESTONES[challenge.kind as ChallengeKind]?.length || 1;

  for (let guard = 0; guard < maxSteps; guard += 1) {
    const synced = await refreshChallengeProgress(current, now);
    if (!isSequentialChallenge(synced) || synced.status !== "completed") return synced;

    const kind = synced.kind as ChallengeKind;
    const sequence = Number(synced.sequence);
    if (sequence >= CHALLENGE_MILESTONES[kind].length - 1) return synced;

    const period = {
      start: new Date(synced.periodStart),
      end: new Date(synced.periodEnd),
      periodKey: String(synced.basePeriodKey || synced.periodKey),
      weekKey: String(synced.weekKey),
      duration: new Date(synced.periodEnd).getTime() - new Date(synced.periodStart).getTime(),
    };
    current = await createSequentialChallenge(
      synced.riderId,
      kind,
      period,
      sequence + 1,
      (Number(synced.deliveryBaseline) || 0) + Number(synced.target),
      now,
    );
  }

  return current;
}

async function settleSequentialChallengePeriod(
  challenge: any,
  now: Date,
): Promise<void> {
  const challenges = riderChallengesCol();
  const kind = challenge.kind as ChallengeKind;
  const basePeriodKey = String(challenge.basePeriodKey || challenge.periodKey);
  const periodFilter = {
    riderId: challenge.riderId,
    kind,
    $or: [
      { basePeriodKey },
      { periodKey: basePeriodKey },
    ],
  };
  const periodChallenges = await challenges
    .find(periodFilter)
    .sort({ sequence: 1, createdAt: 1 })
    .toArray();
  const rootChallenge = periodChallenges[0];
  if (!rootChallenge) return;

  const lockToken = new ObjectId().toHexString();
  let lockAcquired = false;
  while (!lockAcquired) {
    const lock = await challenges.updateOne(
      {
        _id: rootChallenge._id,
        $or: [
          { "periodSettlementLock.until": { $exists: false } },
          { "periodSettlementLock.until": { $lte: new Date() } },
        ],
      },
      {
        $set: {
          periodSettlementLock: {
            token: lockToken,
            until: new Date(Date.now() + 15_000),
          },
        },
      },
    );
    if (lock.modifiedCount === 1) {
      lockAcquired = true;
      break;
    }

    const lockHolder = await challenges.findOne(
      { _id: rootChallenge._id },
      { projection: { periodSettlementLock: 1 } },
    );
    if (!lockHolder) return;
    if (!lockHolder.periodSettlementLock?.until) {
      // The holder removes the lease only after payout/history writes finish.
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  let settlementFinished = false;
  try {
    const latestBeforeSettlement = periodChallenges.at(-1) ?? rootChallenge;
    await advanceSequentialChallenge(latestBeforeSettlement, now);

    const syncedChallenges = await challenges
      .find(periodFilter)
      .sort({ sequence: 1, createdAt: 1 })
      .toArray();
    const deliveredCount = await countChallengeDeliveries(rootChallenge);
    const completedSequence = highestCompletedSequence(kind, deliveredCount);
    const settlementKey = `${challenge.riderId}:${kind}:${basePeriodKey}:highest`;
    const existingSettlementEntry = await riderWalletEntriesCol().findOne({
      challengeKey: settlementKey,
    });
    const existingMilestoneSequence = CHALLENGE_MILESTONES[kind].findIndex(
      (milestone) =>
        milestone.target === Number(existingSettlementEntry?.milestoneTarget),
    );
    const existingSequence = Math.max(
      Number.isInteger(existingSettlementEntry?.challengeSequence)
        ? Number(existingSettlementEntry?.challengeSequence)
        : -1,
      existingMilestoneSequence,
    );
    const settledSequence = Math.max(completedSequence, existingSequence);
    const representativeSequence = Math.max(0, settledSequence);
    const representative =
      syncedChallenges.find(
        (candidate) => Number(candidate.sequence) === representativeSequence,
      ) ?? syncedChallenges[0];
    if (!representative) return;

    await challenges.updateMany(
      periodFilter,
      {
        $set: {
          periodSettlementAt: now,
          settlementSkipped: true,
          updatedAt: now,
        },
        $unset: {
          earnedMilestoneTargets: "",
        },
      },
    );

    if (settledSequence < 0) {
      await challenges.updateOne(
        { _id: representative._id },
        {
          $set: {
            status: "expired",
            progress: Math.max(0, deliveredCount),
            periodDeliveries: Math.max(0, deliveredCount),
            settlementSkipped: false,
            updatedAt: now,
          },
        },
      );
      settlementFinished = true;
      return;
    }

    const milestone = CHALLENGE_MILESTONES[kind][settledSequence];
    const challengeIds = syncedChallenges.map((candidate) => String(candidate._id));
    const existingEntries = await riderWalletEntriesCol()
      .find({
        riderId: challenge.riderId,
        type: "challenge_bonus",
        challengeId: { $in: challengeIds },
      })
      .toArray();
    const otherAwardedAmount = existingEntries
      .filter((entry) => entry.challengeKey !== settlementKey)
      .reduce((total, entry) => total + (Number(entry.amount) || 0), 0);
    const settlementAmount = Math.max(0, milestone.reward - otherAwardedAmount);

    if (settlementAmount > 0) {
      try {
        await riderWalletEntriesCol().updateOne(
          { challengeKey: settlementKey },
          {
            $setOnInsert: {
              riderId: challenge.riderId,
              challengeKey: settlementKey,
              challengeId: String(representative._id),
              weekKey: representative.weekKey,
              milestoneTarget: milestone.target,
              challengeSequence: settledSequence,
              type: "challenge_bonus",
              amount: settlementAmount,
              title: milestoneTitle(
                representative,
                settledSequence + 1,
                milestone,
              ),
              createdAt: now,
            },
          },
          { upsert: true },
        );
      } catch (error: any) {
        if (error?.code !== 11000) throw error;
      }

      const upgradedEntryMetadata = {
        challengeId: String(representative._id),
        weekKey: representative.weekKey,
        milestoneTarget: milestone.target,
        challengeSequence: settledSequence,
        title: milestoneTitle(
          representative,
          settledSequence + 1,
          milestone,
        ),
        updatedAt: now,
      };
      await riderWalletEntriesCol().updateOne(
        {
          challengeKey: settlementKey,
          $or: [
            { challengeSequence: { $exists: false } },
            { challengeSequence: { $lt: settledSequence } },
          ],
        },
        {
          $set: upgradedEntryMetadata,
        },
      );
      await riderWalletEntriesCol().updateOne(
        {
          challengeKey: settlementKey,
          amount: { $lt: settlementAmount },
        },
        {
          $set: {
            ...upgradedEntryMetadata,
            amount: settlementAmount,
          },
        },
      );
    }

    await challenges.updateOne(
      { _id: representative._id },
      {
        $set: {
          tier: sequentialTierLabel(kind, settledSequence),
          target: milestone.target,
          reward: milestone.reward,
          milestones: [{ ...milestone }],
          progress: milestone.target,
          periodDeliveries: Math.max(0, deliveredCount),
          status: "completed",
          completedAt: now,
          payoutKey: settlementKey,
          settlementSkipped: false,
          updatedAt: now,
        },
        $addToSet: {
          earnedMilestoneTargets: milestone.target,
        },
      },
    );
    settlementFinished = true;
  } finally {
    if (settlementFinished) {
      await challenges.updateOne(
        {
          _id: rootChallenge._id,
          "periodSettlementLock.token": lockToken,
        },
        { $unset: { periodSettlementLock: "" } },
      );
    }
  }
}

async function expireSequentialChallengePeriod(
  challenge: any,
  now: Date,
): Promise<void> {
  const challenges = riderChallengesCol();
  const basePeriodKey = String(challenge.basePeriodKey || challenge.periodKey);
  const periodFilter = {
    riderId: challenge.riderId,
    kind: challenge.kind,
    $or: [
      { basePeriodKey },
      { periodKey: basePeriodKey },
    ],
  };
  const periodChallenges = await challenges
    .find(periodFilter)
    .sort({ sequence: 1, createdAt: 1 })
    .toArray();
  if (!periodChallenges.length) return;

  const completedRepresentative = [...periodChallenges]
    .reverse()
    .find((candidate) => candidate.status === "completed");
  const representative = completedRepresentative ?? periodChallenges.at(-1)!;
  const periodDeliveries = await countChallengeDeliveries(representative);

  await challenges.updateMany(periodFilter, {
    $set: {
      settlementSkipped: true,
      periodSettlementAt: now,
      updatedAt: now,
    },
  });
  await challenges.updateMany(
    { ...periodFilter, status: "active" },
    {
      $set: {
        status: "expired",
        expiredAt: now,
        updatedAt: now,
      },
    },
  );
  await challenges.updateOne(
    { _id: representative._id },
    {
      $set: {
        status: representative.status === "completed" ? "completed" : "expired",
        periodDeliveries,
        settlementSkipped: false,
        updatedAt: now,
      },
    },
  );
}

async function ensureChallenge(
  riderId: string,
  kind: ChallengeKind,
  now = new Date(),
): Promise<any> {
  await ensureWalletIndexes();
  const period = challengePeriod(kind, now);
  const challenges = riderChallengesCol();

  // Reconcile only the bounded set of ended challenges that can still settle.
  // Sequential chains advance inside their original period so a delayed order
  // cannot cause an earned next-level reward to be lost at midnight.
  const graceCutoff = new Date(now.getTime() - CHALLENGE_SETTLEMENT_GRACE_MS);
  const endedBeyondGraceSequential = await challenges
    .find({
      riderId,
      kind,
      challengeMode: SEQUENTIAL_CHALLENGE_MODE,
      periodEnd: { $lte: now },
      periodSettlementAt: { $exists: false },
      $or: [
        { settlementGraceUntil: { $lte: now } },
        {
          settlementGraceUntil: { $exists: false },
          periodEnd: { $lte: graceCutoff },
        },
      ],
    })
    .toArray();
  const expiredSequentialPeriods = new Map<string, any>();
  for (const endedChallenge of endedBeyondGraceSequential) {
    const basePeriodKey = String(
      endedChallenge.basePeriodKey || endedChallenge.periodKey,
    );
    expiredSequentialPeriods.set(basePeriodKey, endedChallenge);
  }
  await Promise.all(
    Array.from(expiredSequentialPeriods.values()).map((endedChallenge) =>
      expireSequentialChallengePeriod(endedChallenge, now),
    ),
  );
  await challenges.updateMany(
    {
      riderId,
      kind,
      status: "active",
      periodEnd: { $lte: now },
      $or: [
        { settlementGraceUntil: { $lte: now } },
        {
          settlementGraceUntil: { $exists: false },
          periodEnd: { $lte: graceCutoff },
        },
      ],
    },
    {
      $set: { status: "expired", expiredAt: now, updatedAt: now },
    },
  );

  const endedUnsettledChallenges = await challenges
    .find({
      riderId,
      kind,
      periodEnd: { $lte: now },
      $and: [
        {
          $or: [
            { status: "active" },
            { status: "expired" },
            { status: "completed" },
          ],
        },
        {
          $or: [
            { settlementGraceUntil: { $gt: now } },
            {
              settlementGraceUntil: { $exists: false },
              periodEnd: { $gt: graceCutoff },
            },
          ],
        },
      ],
    })
    .toArray();
  const sequentialPeriods = new Map<string, any>();
  const legacyChallenges: any[] = [];
  for (const endedChallenge of endedUnsettledChallenges) {
    if (isSequentialChallenge(endedChallenge)) {
      const basePeriodKey = String(
        endedChallenge.basePeriodKey || endedChallenge.periodKey,
      );
      const existing = sequentialPeriods.get(basePeriodKey);
      if (!existing || Number(endedChallenge.sequence) > Number(existing.sequence)) {
        sequentialPeriods.set(basePeriodKey, endedChallenge);
      }
    } else {
      legacyChallenges.push(endedChallenge);
    }
  }
  await Promise.all([
    ...Array.from(sequentialPeriods.values()).map((endedChallenge) =>
      settleSequentialChallengePeriod(endedChallenge, now),
    ),
    ...legacyChallenges.map((endedChallenge) =>
      refreshChallengeProgress(endedChallenge, now),
    ),
  ]);

  const currentChallenges = await challenges
    .find({
      riderId,
      kind,
      $or: [
        { basePeriodKey: period.periodKey },
        { periodKey: period.periodKey },
      ],
    })
    .sort({ sequence: -1, createdAt: -1 })
    .toArray();
  const activeSequential = currentChallenges.find(
    (candidate) => isSequentialChallenge(candidate) && candidate.status === "active",
  );
  if (activeSequential) return activeSequential;

  const latestCompletedSequential = currentChallenges.find(
    (candidate) => isSequentialChallenge(candidate) && candidate.status === "completed",
  );
  if (latestCompletedSequential) {
    const sequence = Number(latestCompletedSequential.sequence);
    if (sequence >= CHALLENGE_MILESTONES[kind].length - 1) {
      return latestCompletedSequential;
    }
    return createSequentialChallenge(
      riderId,
      kind,
      period,
      sequence + 1,
      (Number(latestCompletedSequential.deliveryBaseline) || 0) +
        Number(latestCompletedSequential.target),
      now,
    );
  }

  const otherSequential = currentChallenges.find(isSequentialChallenge);
  if (otherSequential) return otherSequential;

  const legacyChallenge = currentChallenges[0];
  if (legacyChallenge) return migrateCurrentChallenge(legacyChallenge, now);

  return createSequentialChallenge(riderId, kind, period, 0, 0, now);
}

async function refreshChallengeProgress(challenge: any, now = new Date()): Promise<any> {
  const challenges = riderChallengesCol();
  const lockToken = new ObjectId().toHexString();
  const lockUntil = new Date(Date.now() + 15_000);
  const lock = await challenges.updateOne(
    {
      _id: challenge._id,
      $or: [
        { "settlementLock.until": { $exists: false } },
        { "settlementLock.until": { $lte: new Date() } },
      ],
    },
    {
      $set: {
        settlementLock: { token: lockToken, until: lockUntil },
      },
    },
  );

  // A simultaneous refresh is already reconciling this exact period. Return
  // its current state rather than racing it; the short lease recovers safely
  // if that request is interrupted.
  if (lock.modifiedCount !== 1) {
    const current = await challenges.findOne({ _id: challenge._id });
    if (!current) throw new Error("Rider challenge no longer exists");
    return current;
  }

  try {
    const currentBeforeCount = await challenges.findOne({ _id: challenge._id });
    if (!currentBeforeCount) throw new Error("Rider challenge no longer exists");
    const milestones = milestonesForChallenge(currentBeforeCount);
    const finalMilestone = milestones.at(-1);
    if (!finalMilestone) throw new Error("Rider challenge has no valid milestone");

    const deliveredCount = await countChallengeDeliveries(currentBeforeCount);
    const challengeProgress = isSequentialChallenge(currentBeforeCount)
      ? Math.max(0, deliveredCount - (Number(currentBeforeCount.deliveryBaseline) || 0))
      : deliveredCount;
    const ownershipFilter = { _id: challenge._id, "settlementLock.token": lockToken };

    // Sequential progress counts only rides completed after the previous
    // challenge's baseline. Active challenges can decrease when a shared order
    // is removed, while completed rewards remain terminal and monotonic.
    const progressUpdate =
      currentBeforeCount.status === "completed"
        ? { $max: { progress: challengeProgress }, $set: { updatedAt: now } }
        : { $set: { progress: challengeProgress, updatedAt: now } };
    await challenges.updateOne(
      ownershipFilter,
      progressUpdate,
    );
    let current = await challenges.findOne({ _id: challenge._id });
    if (!current) throw new Error("Rider challenge no longer exists");

    // Delayed order writes may become visible after the first period-end read.
    // An expired challenge is therefore still allowed to settle to completed,
    // but never regresses from completed or receives a duplicate entry.
    if (
      current.status !== "completed" &&
      Number(current.progress) >= finalMilestone.target
    ) {
      await challenges.updateOne(
        {
          ...ownershipFilter,
          status: { $in: ["active", "expired"] },
          progress: { $gte: finalMilestone.target },
        },
        { $set: { status: "completed", completedAt: now, updatedAt: now } },
      );
    } else if (current.status === "active" && new Date(current.periodEnd) <= now) {
      await challenges.updateOne(
        {
          ...ownershipFilter,
          status: "active",
          progress: { $lt: finalMilestone.target },
        },
        {
          $set: {
            status: "expired",
            updatedAt: now,
            settlementGraceUntil:
              current.settlementGraceUntil ||
              new Date(
                new Date(current.periodEnd).getTime() +
                  CHALLENGE_SETTLEMENT_GRACE_MS,
              ),
          },
        },
      );
    }

    current = await challenges.findOne({ _id: challenge._id });
    if (!current) throw new Error("Rider challenge no longer exists");

    if (isSequentialChallenge(current)) {
      // Sequential stages are progress markers only while their PKT period is
      // open. The period settlement chooses one highest completed reward.
    } else if (hasMilestoneDefinition(current)) {
      const currentMilestones = milestonesForChallenge(current);
      const reachedMilestones = currentMilestones.filter(
        (milestone) => Number(current.progress) >= milestone.target,
      );

      // Legacy cumulative milestone records retain their historical per-goal
      // payout keys. Only explicitly sequential periods use highest-only
      // settlement, preventing a rollout from paying legacy records twice.
      await Promise.all(
        reachedMilestones.map((milestone, index) => {
          const goalNumber = currentMilestones.findIndex(
            (candidate) => candidate.target === milestone.target,
          ) + 1;
          const challengeKey = `${current.riderId}:${current.kind}:${current.periodKey}:milestone:${milestone.target}`;
          return riderWalletEntriesCol().updateOne(
            { challengeKey },
            {
              $setOnInsert: {
                riderId: current.riderId,
                challengeKey,
                challengeId: String(current._id),
                weekKey: current.weekKey,
                milestoneTarget: milestone.target,
                type: "challenge_bonus",
                amount: milestone.reward,
                title: milestoneTitle(current, goalNumber || index + 1, milestone),
                createdAt: now,
              },
            },
            { upsert: true },
          );
        }),
      );

      if (reachedMilestones.length > 0) {
        await challenges.updateOne(
          ownershipFilter,
          {
            $addToSet: {
              earnedMilestoneTargets: {
                $each: reachedMilestones.map((milestone) => milestone.target),
              },
            },
            $set: { updatedAt: now },
          },
        );
      }
    } else if (
      current.status === "completed" &&
      new Date(current.periodEnd) <= now
    ) {
      // Legacy records created before the milestone rollout retain the
      // historical one-bonus key and amount. This avoids duplicate payouts
      // while keeping prior Wallet history readable.
      const challengeKey = `${current.riderId}:${current.kind}:${current.periodKey}`;
      await riderWalletEntriesCol().updateOne(
        { challengeKey },
        {
          $setOnInsert: {
            riderId: current.riderId,
            challengeKey,
            challengeId: String(current._id),
            weekKey: current.weekKey,
            type: "challenge_bonus",
            amount: Number(current.reward) || 0,
            title: legacyChallengeTitle(current),
            createdAt: current.completedAt || now,
          },
        },
        { upsert: true },
      );
    }

    return (await challenges.findOne({ _id: challenge._id })) ?? current;
  } finally {
    await challenges.updateOne(
      { _id: challenge._id, "settlementLock.token": lockToken },
      { $unset: { settlementLock: "" } },
    );
  }
}

function riderEarningForOrder(order: any, tillNoonFare: number): number {
  const fare = tillNoonFare > 0 ? tillNoonFare : Number(order.riderFare) || 0;
  return Math.round(fare + (Number(order.tip) || 0));
}

async function awardFastDeliveryBonus(
  order: any,
  riderId: string,
  deliveredAt: Date,
): Promise<boolean> {
  const acceptedAt = new Date(order.acceptedTime);
  if (Number.isNaN(acceptedAt.getTime()) || Number.isNaN(deliveredAt.getTime())) return false;
  const durationMs = deliveredAt.getTime() - acceptedAt.getTime();
  if (durationMs < 0 || durationMs > FAST_DELIVERY_WINDOW_MS) return false;

  await ensureWalletIndexes();
  const orderId = String(order._id);
  const entryKey = `fast_delivery:${riderId}:${orderId}`;
  const weekKey = pktDateKey(pktPeriodStartAt("week", deliveredAt));
  await riderWalletEntriesCol().updateOne(
    { entryKey },
    {
      $setOnInsert: {
        entryKey,
        // challengeKey already has a legacy unique index. Reuse the same
        // per-order key here so fast bonuses never collide on a missing value.
        challengeKey: entryKey,
        riderId,
        orderId,
        weekKey,
        type: "fast_delivery_bonus",
        amount: FAST_DELIVERY_BONUS,
        title: "Fast delivery bonus",
        createdAt: deliveredAt,
        deliveryDurationMinutes: Math.ceil(durationMs / 60_000),
      },
    },
    { upsert: true },
  );
  return true;
}

// Aggregate a rider's delivered-order earnings into total / today / week / month
// buckets, plus COD-only cash collected. Pay per delivered order is the rider's
// CURRENT tillNoonFare (passed in); the per-order snapshot (riderFare) is only a
// fallback for riders with no tillNoonFare. Never the customer's deliveryCharges.
// Shared by /rider/me and /rider/earnings.
async function computeEarnings(
  riderId: string,
  tillNoonFare = 0,
  selectedDate?: { value: string; start: Date },
) {
  const dayStart = pktPeriodStart("day");
  const weekStart = pktPeriodStart("week");
  const monthStart = pktPeriodStart("month");

  // Use the rider's current tillNoonFare per delivered order when set; otherwise
  // fall back to that order's stored snapshot. Never the customer's deliveryCharges.
  const snapshotExpr = {
    $convert: {
      input: { $ifNull: ["$riderFare", 0] },
      to: "double",
      onError: 0,
      onNull: 0,
    },
  };
  const fareExpr =
    tillNoonFare > 0 ? { $literal: tillNoonFare } : snapshotExpr;
  // Cash the rider physically collects.
  // For prepaid+COD orders the customer already paid the restaurant directly, so
  // the rider only collects the platform-margin portion: orderTotal − prepaidActualTotal.
  // For postpaid COD the rider collects the full orderTotal as before.
  // For non-COD orders the rider collects nothing (0).
  const orderTotalDbl = {
    $convert: { input: "$orderTotal", to: "double", onError: 0, onNull: 0 },
  };
  const isCodExpr = {
    $in: [{ $ifNull: ["$paymentType", "$paymentMethod"] }, COD_TYPES],
  };
  const isPrepaidExpr = { $eq: ["$billingMode", "prepaid"] };
  // Sum of actualPrice × count across all products in the order (falls back to price).
  const prepaidActualTotalExpr = {
    $sum: {
      $map: {
        input: { $ifNull: ["$products", []] },
        as: "p",
        in: {
          $multiply: [
            {
              $convert: {
                input: {
                  $ifNull: ["$$p.actualPrice", { $ifNull: ["$$p.price", 0] }],
                },
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
            {
              $convert: {
                input: { $ifNull: ["$$p.count", 1] },
                to: "double",
                onError: 1,
                onNull: 1,
              },
            },
          ],
        },
      },
    },
  };
  // VAT amount on this order (0 if absent).
  const vatAmountDbl = {
    $convert: { input: { $ifNull: ["$vatAmount", 0] }, to: "double", onError: 0, onNull: 0 },
  };
  const isRestaurantExpr = { $eq: ["$shopType", "restaurant"] };
  // For prepaid COD, the margin the rider physically owes is:
  //   restaurant + vatAmount > 0 → orderTotal − actualPriceTotal − vatAmount
  //   otherwise                  → orderTotal − actualPriceTotal
  // This mirrors the pendingCollection increment logic applied on delivery.
  const prepaidCodMarginExpr = {
    $cond: [
      { $and: [isRestaurantExpr, { $gt: [vatAmountDbl, 0] }] },
      {
        $max: [
          { $subtract: [{ $subtract: [orderTotalDbl, prepaidActualTotalExpr] }, vatAmountDbl] },
          0,
        ],
      },
      { $max: [{ $subtract: [orderTotalDbl, prepaidActualTotalExpr] }, 0] },
    ],
  };
  const codAmountExpr = {
    $cond: [
      isCodExpr,
      {
        $cond: [
          isPrepaidExpr,
          prepaidCodMarginExpr,
          orderTotalDbl,
        ],
      },
      0,
    ],
  };
  // For prepaid non-COD orders the platform margin (orderTotal − prepaidActualTotal)
  // was not collected in cash by the rider, so it must be subtracted from the
  // rider's displayed cash-in-hand balance (pendingCollection).
  const prepaidNonCodDeductExpr = {
    $cond: [
      { $and: [isPrepaidExpr, { $not: [isCodExpr] }] },
      { $max: [{ $subtract: [orderTotalDbl, prepaidActualTotalExpr] }, 0] },
      0,
    ],
  };
  // Tip left by the customer on this order (0 if absent).
  const tipExpr = {
    $convert: {
      input: { $ifNull: ["$tip", 0] },
      to: "double",
      onError: 0,
      onNull: 0,
    },
  };
  const group = {
    _id: null,
    count: { $sum: 1 },
    // Base pay (tillNoonFare or snapshot) + any customer tip.
    earnings: { $sum: { $add: [fareExpr, tipExpr] } },
    orderAmount: { $sum: codAmountExpr },
    prepaidNonCodDeduction: { $sum: prepaidNonCodDeductExpr },
  };

  const facets: Record<string, any[]> = {
    total: [{ $group: group }],
    today: [{ $match: { createdAt: { $gte: dayStart } } }, { $group: group }],
    week: [{ $match: { createdAt: { $gte: weekStart } } }, { $group: group }],
    month: [{ $match: { createdAt: { $gte: monthStart } } }, { $group: group }],
  };
  if (selectedDate) {
    facets.selected = [
      {
        $match: {
          createdAt: {
            $gte: selectedDate.start,
            $lt: new Date(selectedDate.start.getTime() + PKT_DAY_MS),
          },
        },
      },
      { $group: group },
    ];
  }

  const [agg] = await ordersCol()
    .aggregate([
      { $match: { riderId, status: DELIVERED_STATUS } },
      { $facet: facets },
    ])
    .toArray();

  const pick = (arr: any[]) => ({
    earnings: Math.round(arr?.[0]?.earnings || 0),
    count: arr?.[0]?.count || 0,
    orderAmount: Math.round(arr?.[0]?.orderAmount || 0),
  });
  const total = pick(agg?.total);
  const today = pick(agg?.today);
  const week = pick(agg?.week);
  const month = pick(agg?.month);
  const selected = selectedDate ? pick(agg?.selected) : null;

  return {
    totalEarnings: total.earnings,
    totalDeliveries: total.count,
    totalOrderAmount: total.orderAmount,
    todayEarnings: today.earnings,
    todayDeliveries: today.count,
    todayOrderAmount: today.orderAmount,
    weekEarnings: week.earnings,
    weekDeliveries: week.count,
    weekOrderAmount: week.orderAmount,
    monthEarnings: month.earnings,
    monthDeliveries: month.count,
    monthOrderAmount: month.orderAmount,
    ...(selectedDate
      ? {
          selectedDate: selectedDate.value,
          selectedEarnings: selected?.earnings ?? 0,
          selectedDeliveries: selected?.count ?? 0,
          selectedOrderAmount: selected?.orderAmount ?? 0,
        }
      : {}),
    // Total deduction to subtract from the rider's displayed pendingCollection for
    // prepaid non-COD orders (customer paid online; rider never held that cash).
    prepaidNonCodDeduction: Math.round(
      agg?.total?.[0]?.prepaidNonCodDeduction || 0
    ),
  };
}

async function saveSession(req: any) {
  await new Promise<void>((ok, fail) =>
    req.session.save((e: any) => (e ? fail(e) : ok()))
  );
}

// Register — creates a rider in the shared users collection
router.post("/rider/register", async (req: any, res: any) => {
  try {
    const { name, phone, password, city, vehicleType } = req.body;
    if (!name || !phone || !password || !city || !vehicleType)
      return res.status(400).json({ message: "All fields are required" });
    const col = usersCol();
    const phoneNorm = normPhone(phone);
    const existing = await col.findOne({ type: "rider", phone: phoneNorm });
    if (existing && !isDeleted(existing))
      return res.status(409).json({ message: "Phone number already registered" });
    const now = new Date();
    const rider = {
      type: "rider",
      name: String(name).trim(),
      phone: phoneNorm,
      password: await bcrypt.hash(String(password), 12),
      city,
      vehicleType,
      isOnline: false,
      status: "idle",
      deleted: false,
      verified: false,
      riderZones: [],
      pendingCollection: 0,
      unpaidCollection: 0,
      tillNoonFare: 0,
      wallet: { amount: 0, isUsable: true },
      createdAt: now,
      updatedAt: now,
    };
    const result = await col.insertOne(rider as any);
    (req.session as any).riderId = String(result.insertedId);
    await saveSession(req);
    res.status(201).json({
      ...(await safeRider({ ...rider, _id: result.insertedId })),
      token: signRiderToken(String(result.insertedId)),
    });
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Login
router.post("/rider/login", async (req: any, res: any) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password)
      return res.status(400).json({ message: "Phone and password are required" });
    const phoneNorm = normPhone(phone);
    const rider = await usersCol().findOne({ type: "rider", phone: phoneNorm });
    if (!rider || isDeleted(rider) || !(await checkPassword(String(password), rider.password)))
      return res.status(401).json({ message: "Invalid phone number or password" });
    (req.session as any).riderId = String(rider._id);
    await saveSession(req);
    res.json({ ...(await safeRider(rider)), token: signRiderToken(String(rider._id)) });
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Logout
router.post("/rider/logout", (req: any, res: any) => {
  (req.session as any).riderId = undefined;
  req.session.save(() => res.json({ ok: true }));
});

// Get current rider
router.get("/rider/me", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const rider = await findRiderById(riderId);
    if (!rider || isDeleted(rider)) {
      (req.session as any).riderId = undefined;
      return res.status(401).json({ message: "Rider not found" });
    }
    const earn = await computeEarnings(riderId, Number(rider.tillNoonFare) || 0);
    const base = await safeRider(rider);
    res.json({
      ...base,
      pendingCollection: base.pendingCollection,
      totalEarnings: earn.totalEarnings,
      totalDeliveries: earn.totalDeliveries,
    });
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Customer reviews — only reviews belonging to the authenticated rider.
// The response summary is calculated from the same bounded list shown to the
// rider so its rating and count always match the displayed review source.
router.get("/rider/reviews", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const rider = await findRiderById(riderId);
    if (!rider || isDeleted(rider)) {
      return res.status(401).json({ message: "Rider not found" });
    }

    const docs = await reviewsCol()
      .find({ riderId, type: "delivery" } as any)
      .sort({ createdAt: -1, _id: -1 })
      .limit(100)
      .toArray();

    const reviews = docs.map((review: any) => {
      const rawCreatedAt = review.createdAt;
      const parsedCreatedAt =
        rawCreatedAt instanceof Date
          ? rawCreatedAt
          : new Date(String(rawCreatedAt || ""));
      const createdAt = Number.isNaN(parsedCreatedAt.getTime())
        ? null
        : parsedCreatedAt.toISOString();
      const numericRating = Number(review.riderRating);
      const comment =
        typeof review.comment === "string" && review.comment.trim()
          ? review.comment.trim()
          : null;

      return {
        id: String(review._id),
        rating: Number.isFinite(numericRating) ? numericRating : 0,
        comment,
        createdAt,
      };
    });

    const ratingCount = reviews.length;
    const rating =
      ratingCount > 0
        ? Math.round(
            (reviews.reduce((sum: number, review: any) => sum + review.rating, 0) /
              ratingCount) *
              10,
          ) / 10
        : 0;

    res.json({ reviews, rating, ratingCount });
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Toggle availability
router.put("/rider/availability", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const { isOnline } = req.body;
    const rider = await findRiderById(riderId);
    if (!rider) return res.status(404).json({ message: "Rider not found" });
    await usersCol().updateOne(
      { _id: rider._id },
      { $set: { isOnline: !!isOnline, updatedAt: new Date() } }
    );
    res.json({ ok: true, isOnline: !!isOnline });
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Available orders — unassigned admin-accepted orders, filtered to the rider's city & zones.
// Faithful to the original: a rider only sees orders in their city whose zone is in
// their assigned riderZones. (Zone filter applies only when the rider has zones set.)
router.get("/rider/orders/available", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const rider = await findRiderById(riderId);
    if (!rider) return res.status(404).json({ message: "Rider not found" });

    const query: Record<string, any> = {
      status: AVAILABLE_STATUS,
      selfDelivery: { $ne: true },
      orderType: { $ne: "PickUp" },
      $or: [{ riderId: { $exists: false } }, { riderId: null }, { riderId: "" }],
    };
    if (rider.city) query.city = rider.city;
    const zones = Array.isArray(rider.riderZones) ? rider.riderZones.filter(Boolean) : [];
    if (zones.length) query.zone = { $in: zones };

    const docs = await ordersCol()
      .find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    const tnf = Number(rider.tillNoonFare) || 0;
    res.json(docs.map((d: any) => normalizeOrder(d, tnf)));
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Active orders — assigned to this rider, not yet delivered
router.get("/rider/orders/active", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const rider = await findRiderById(riderId);
    const tnf = Number(rider?.tillNoonFare) || 0;
    const docs = await ordersCol()
      .find({ riderId, status: { $in: ACTIVE_STATUSES } })
      .sort({ updatedAt: -1 })
      .toArray();
    // Fare shown = the rider's current tillNoonFare (overrides the stored snapshot).
    res.json(docs.map((d: any) => normalizeOrder(d, tnf)));
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Order history — delivered orders for this rider, optionally filtered by period.
router.get("/rider/orders/history", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const period = String(req.query.period || "all");
    const selectedDate = String(req.query.date || "").trim();
    // Filter by createdAt in the DB query (not updatedAt — it is bulk-written and
    // identical across orders) so the row limit never drops in-period orders.
    const query: any = { riderId, status: DELIVERED_STATUS };
    if (selectedDate) {
      const start = pktDateStart(selectedDate);
      if (!start) {
        return res.status(400).json({ message: "date must be a valid YYYY-MM-DD value" });
      }
      query.createdAt = {
        $gte: start,
        $lt: new Date(start.getTime() + PKT_DAY_MS),
      };
    } else if (period === "today" || period === "week" || period === "month") {
      query.createdAt = {
        $gte: pktPeriodStart(period === "today" ? "day" : period),
      };
    }
    const rider = await findRiderById(riderId);
    const tnf = Number(rider?.tillNoonFare) || 0;
    const docs = await ordersCol()
      .find(query)
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    // Fare shown = the rider's current tillNoonFare (overrides the stored snapshot).
    res.json(docs.map((d: any) => normalizeOrder(d, tnf)));
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Accept order
router.post("/rider/orders/:orderId/accept", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;

    let orderObjectId: ObjectId;
    try {
      orderObjectId = new ObjectId(req.params.orderId);
    } catch {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const rider = await findRiderById(riderId);
    if (!rider) return res.status(404).json({ message: "Rider not found" });

    const targetOrder = await ordersCol().findOne({ _id: orderObjectId });
    if (!targetOrder) return res.status(404).json({ message: "Order not found" });

    // maxOrderLimit caps how many orders a rider can carry at once (admin-owned field).
    // The limit is enforced from the current active-order count.
    const maxOrderLimit = Number(rider?.maxOrderLimit || 0);
    if (maxOrderLimit > 0) {
      const activeCount = await ordersCol().countDocuments({
        riderId,
        status: { $in: ACTIVE_STATUSES },
      });
      if (activeCount >= maxOrderLimit)
        return res.status(400).json({
          message: `You can only have ${maxOrderLimit} active order${maxOrderLimit === 1 ? "" : "s"} at a time. Complete a current delivery before accepting more.`,
        });
    }

    // Previous-day cash clearance gate.
    // Blocks only when pendingCollection > 0 AND the rider has NO COD deliveries
    // in the current collection window (after today's 8AM PKT cutoff).
    // If any COD order was delivered today (after 8AM PKT), the pending cash is
    // from the current window — legitimate — and the rider is not blocked.
    // Non-COD orders are excluded: the rider never holds physical cash for them.
    const pendingCollectionRaw = Number(rider?.pendingCollection || 0);
    const targetPayType = String(
      targetOrder?.paymentType || targetOrder?.paymentMethod || ""
    ).toLowerCase();
    const isTargetCod = COD_TYPES.some((t) => t.toLowerCase() === targetPayType);
    if (pendingCollectionRaw > 0) {
      const windowStart = pkt8AMCutoff();
      // Look for any COD delivery in today's window (after 8AM PKT).
      // If found, the pending cash is from the current window — do not block.
      // If none found, the pending cash is from a previous day — block.
      const todayDelivery = await ordersCol().findOne({
        riderId,
        status: "Delivered",
        timeWhenDelivered: { $exists: true, $gt: "" },
        createdAt: { $gte: windowStart },
        $expr: {
          $in: [
            { $ifNull: ["$paymentType", "$paymentMethod"] },
            COD_TYPES,
          ],
        },
      });
      if (!todayDelivery) {
        return res.status(400).json({
          message:
            "You have uncollected cash from a previous day. Please submit your cash to the company before accepting new orders.",
        });
      }
    }

    // Cash-collection gate (admin-owned fields, read-only here — never written by this route).
    const pendingCollection = Number(rider?.pendingCollection || 0);
    const paymentLimit = Number(rider?.paymentLimit || 0);
    if (paymentLimit > 0) {
      if (pendingCollection >= paymentLimit)
        return res.status(400).json({
          message:
            "You've reached your cash collection limit. Please clear your pending payment with the company before accepting new orders.",
        });
      // Only COD orders add to the rider's cash-in-hand exposure; online/wallet/split
      // payments are settled electronically and should never be blocked by this limit.
      const payTypeCash = String(
        targetOrder?.paymentType || targetOrder?.paymentMethod || ""
      );
      const isCod = COD_TYPES.some(
        (t) => t.toLowerCase() === payTypeCash.toLowerCase()
      );
      if (isCod) {
        const remainingLimit = paymentLimit - pendingCollection;
        const rawTotal = Number(targetOrder?.orderTotal || 0);
        // For prepaid COD, rider only collects the platform-margin portion.
        const isPrepaid =
          String(targetOrder?.billingMode || "").toLowerCase() === "prepaid";
        const prepaidAmt =
          isPrepaid && Array.isArray(targetOrder?.products)
            ? (targetOrder.products as any[]).reduce(
                (s: number, p: any) =>
                  s +
                  Number(p.actualPrice ?? p.price ?? 0) *
                    (Number(p.count) || 1),
                0
              )
            : 0;
        const effectiveCollect = isPrepaid
          ? Math.max(rawTotal - prepaidAmt, 0)
          : rawTotal;
        if (effectiveCollect > remainingLimit)
          return res.status(400).json({
            message:
              "Accepting this order would put you over your cash collection limit. Please clear your pending payment with the company first.",
          });
      }
    }

    const now = new Date();
    // Atomic update guards against a race where two riders accept the same order at once —
    // it only succeeds if the order is still available and has no riderId assigned.
    const updated = await ordersCol().findOneAndUpdate(
      {
        _id: orderObjectId,
        status: AVAILABLE_STATUS,
        $or: [{ riderId: { $exists: false } }, { riderId: null }, { riderId: "" }],
      },
      {
        $set: {
          riderId,
          riderName: rider.name,
          riderPhone: rider.phone,
          riderFare: rider.tillNoonFare ? Number(rider.tillNoonFare) : undefined,
          status: "Rider Accepted",
          acceptedTime: now,
          updatedAt: now,
        },
      },
      { returnDocument: "after" }
    );
    if (!updated) return res.status(409).json({ message: "Order already taken or unavailable." });
    // Rider is now carrying at least one order — mark "on delivery".
    await usersCol().updateOne(
      { _id: new ObjectId(riderId) },
      { $set: { status: "on delivery" } }
    );
    res.json(normalizeOrder(updated, Number(rider.tillNoonFare) || 0));
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Mark arrived at restaurant — additive checkpoint, canonical status stays "Rider Accepted"
router.post("/rider/orders/:orderId/arrived", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const rider = await findRiderById(riderId);
    const tnf = Number(rider?.tillNoonFare) || 0;
    let orderObjectId: ObjectId;
    try {
      orderObjectId = new ObjectId(req.params.orderId);
    } catch {
      return res.status(400).json({ message: "Invalid order id" });
    }
    const updated = await ordersCol().findOneAndUpdate(
      { _id: orderObjectId, riderId, status: "Rider Accepted" },
      { $set: { riderArrived: true, riderArrivedTime: pktTimeString(new Date()), updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!updated)
      return res
        .status(409)
        .json({ message: "Order not assigned to you, or not in the accepted state." });
    res.json(normalizeOrder(updated, tnf));
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Update order status
router.put("/rider/orders/:orderId/status", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const { status } = req.body;
    if (!["Rider Picked Up", DELIVERED_STATUS].includes(status))
      return res.status(400).json({ message: "Invalid status" });
    const rider = await findRiderById(riderId);
    const tnf = Number(rider?.tillNoonFare) || 0;
    let orderObjectId: ObjectId;
    try {
      orderObjectId = new ObjectId(req.params.orderId);
    } catch {
      return res.status(400).json({ message: "Invalid order id" });
    }
    // Enforce the 3-step progression server-side: a rider must mark "Arrived at
    // Restaurant" (riderArrived) before picking up. This guards against stale
    // clients or direct API calls skipping the checkpoint.
    //
    // For "Delivered" we intentionally do NOT filter on status === "Rider Picked Up".
    // The external admin system may revert the status between the moment our
    // "Rider Picked Up" write lands and the moment the rider presses "Delivered"
    // (observed: < 5 s). Instead we gate on two additive timestamps that we own
    // and admin never clears:
    //   • pickUpTime present  → rider physically picked up the order
    //   • timeWhenDelivered absent → not yet delivered (prevents double-delivery)
    const now = new Date();
    const filter: Record<string, any> =
      status === "Rider Picked Up"
        ? { _id: orderObjectId, riderId, status: "Rider Accepted", riderArrived: true }
        : {
            _id: orderObjectId,
            riderId,
            pickUpTime: { $exists: true },
            timeWhenDelivered: { $exists: false },
          };
    let fastDeliveryGeofenceMessage: string | null = null;
    if (status === DELIVERED_STATUS) {
      const pendingDelivery = await ordersCol().findOne(filter);
      if (!pendingDelivery) {
        return res.status(409).json({
          message: "Invalid status transition, or order not assigned to you.",
        });
      }
      fastDeliveryGeofenceMessage = deliveryGeofenceMessage(
        pendingDelivery,
        riderId,
      );
    }
    // Additive timestamps that mirror the original app (no shared counter writes).
    const extra: Record<string, any> =
      status === "Rider Picked Up"
        ? { pickUpTime: pktTimeString(now) }
        : {
            timeWhenDelivered: pktTimeString(now),
            riderDeliveredAt: now,
            paidToRider: false,
          };
    const updated = await ordersCol().findOneAndUpdate(
      filter,
      { $set: { status, updatedAt: now, ...extra } },
      { returnDocument: "after" }
    );
    if (!updated) {
      const message =
        status === "Rider Picked Up"
          ? "Mark 'Arrived at Restaurant' first, or order not assigned to you."
          : "Invalid status transition, or order not assigned to you.";
      return res.status(409).json({ message });
    }
    // On delivery of a prepaid+COD order, accumulate the cash the rider collected
    // (orderTotal − sum(p.actualPrice × count)) into the rider's pendingCollection.
    if (status === DELIVERED_STATUS) {
      const payType = String(
        updated.paymentType || updated.paymentMethod || ""
      ).toLowerCase();
      const isCod = COD_TYPES.some((t) => t.toLowerCase() === payType);
      if (isCod) {
        const orderTotal = toNum(updated.orderTotal);
        let collectAmt = orderTotal;
        if (updated.billingMode === "prepaid") {
          // Prepaid COD: rider collects only the margin (orderTotal − items actualPrice).
          // For restaurant orders with vatAmount > 0, VAT is also pre-settled with the
          // restaurant, so deduct vatAmount too: margin = orderTotal − (actualPrice + VAT).
          const products: any[] = Array.isArray(updated.products)
            ? updated.products
            : [];
          const actualPriceTotal = products.reduce(
            (s: number, p: any) =>
              s +
              toNum(p.actualPrice ?? p.price ?? p.net) * (Number(p.count) || 1),
            0
          );
          const vatAmount =
            String(updated.shopType || "").toLowerCase() === "restaurant"
              ? toNum(updated.vatAmount)
              : 0;
          collectAmt = Math.max(orderTotal - actualPriceTotal - vatAmount, 0);
        }
        // Postpaid COD: rider collects full orderTotal (collectAmt already = orderTotal).
        if (collectAmt > 0) {
          await usersCol().updateOne(
            { _id: new ObjectId(riderId) },
            { $inc: { pendingCollection: collectAmt } }
          );
        }
      } else if (updated.billingMode === "prepaid") {
        // Prepaid non-COD: customer paid online — rider never held this cash.
        // Deduct actualPrice total (+ vatAmount for restaurant orders) from pendingCollection.
        const products: any[] = Array.isArray(updated.products)
          ? updated.products
          : [];
        const actualPriceTotal = products.reduce(
          (s: number, p: any) =>
            s + toNum(p.actualPrice ?? p.price ?? p.net) * (Number(p.count) || 1),
          0
        );
        const vatAmount =
          String(updated.shopType || "").toLowerCase() === "restaurant"
            ? toNum(updated.vatAmount)
            : 0;
        const deductAmt = actualPriceTotal + vatAmount;
        if (deductAmt > 0) {
          await usersCol().updateOne(
            { _id: new ObjectId(riderId) },
            { $inc: { pendingCollection: -deductAmt } }
          );
        }
      }
      // Rider status follows the current active-order count.
      const remainingActiveOrders = await ordersCol().countDocuments({
        riderId,
        status: { $in: ACTIVE_STATUSES },
      });
      if (remainingActiveOrders === 0) {
        await usersCol().updateOne(
          { _id: new ObjectId(riderId) },
          { $set: { status: "idle" } }
        );
      }
      if (!fastDeliveryGeofenceMessage) {
        try {
          await awardFastDeliveryBonus(updated, riderId, now);
        } catch (bonusError) {
          // Delivery is already committed. Never report it as failed because its
          // additive wallet award is temporarily unavailable.
          req.log.error(bonusError, "Could not persist fast-delivery bonus");
        }
      } else {
        req.log.info(
          { orderId: String(orderObjectId), reason: fastDeliveryGeofenceMessage },
          "Fast-delivery bonus skipped because rider was not within the delivery geofence",
        );
      }
    }
    res.json(normalizeOrder(updated, tnf));
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Weekly wallet — live delivery earnings plus persisted automatic challenge bonuses.
router.get("/rider/wallet", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const rider = await findRiderById(riderId);
    if (!rider) {
      res.status(404).json({ message: "Rider not found" });
      return;
    }

    const now = new Date();
    const weekStart = pktPeriodStart("week");
    const weekEnd = new Date(weekStart.getTime() + 7 * PKT_DAY_MS);
    const weekKey = pktDateKey(weekStart);
    const tillNoonFare = Number(rider.tillNoonFare) || 0;

    const [dailyChallenge, weeklyChallenge] = await Promise.all([
      ensureChallenge(riderId, "daily", now),
      ensureChallenge(riderId, "weekly", now),
    ]);
    const [syncedDaily, syncedWeekly] = await Promise.all([
      advanceSequentialChallenge(dailyChallenge, now),
      advanceSequentialChallenge(weeklyChallenge, now),
    ]);

    const orders = await ordersCol()
      .find(
        {
          riderId,
          status: DELIVERED_STATUS,
          createdAt: { $gte: weekStart, $lt: weekEnd },
        },
        {
          projection: {
            _id: 1,
            orderNum: 1,
            createdAt: 1,
            riderFare: 1,
            tip: 1,
          },
        },
      )
      .sort({ createdAt: -1 })
      .toArray();

    const [bonusEntries, recentChallengeDocs] = await Promise.all([
      riderWalletEntriesCol()
        .find({
          riderId,
          weekKey,
          type: { $in: ["challenge_bonus", "fast_delivery_bonus"] },
        })
        .sort({ createdAt: -1 })
        .toArray(),
      riderChallengesCol()
        .find({
          riderId,
          periodEnd: { $lte: now },
          settlementSkipped: { $ne: true },
        })
        .sort({ periodEnd: -1, updatedAt: -1, createdAt: -1 })
        .limit(10)
        .toArray(),
    ]);
    const visibleChallengeDocs = [syncedDaily, syncedWeekly, ...recentChallengeDocs];
    const challengeIds = Array.from(
      new Set(visibleChallengeDocs.map((challenge) => String(challenge._id))),
    );
    const visibleChallengeIdSet = new Set(challengeIds);
    const fallbackPayoutOwnerByKey = new Map<string, string>();
    for (const challenge of recentChallengeDocs) {
      for (const payoutKey of legacyChallengePayoutKeys(challenge)) {
        if (!fallbackPayoutOwnerByKey.has(payoutKey)) {
          fallbackPayoutOwnerByKey.set(payoutKey, String(challenge._id));
        }
      }
    }
    const fallbackPayoutKeys = Array.from(fallbackPayoutOwnerByKey.keys());
    const challengePayoutEntries = challengeIds.length
      ? await riderWalletEntriesCol()
          .find({
            riderId,
            type: "challenge_bonus",
            $or: [
              { challengeId: { $in: challengeIds } },
              ...(fallbackPayoutKeys.length
                ? [{ challengeKey: { $in: fallbackPayoutKeys } }]
                : []),
            ],
          })
          .toArray()
      : [];
    const payoutByChallengeId = challengePayoutEntries.reduce(
      (totals: Map<string, number>, entry: any) => {
        const entryChallengeId = String(entry.challengeId || "");
        const challengeId = visibleChallengeIdSet.has(entryChallengeId)
          ? entryChallengeId
          : fallbackPayoutOwnerByKey.get(String(entry.challengeKey || "")) || "";
        if (!challengeId) return totals;
        totals.set(
          challengeId,
          (totals.get(challengeId) || 0) + (Number(entry.amount) || 0),
        );
        return totals;
      },
      new Map<string, number>(),
    );
    const challengeResponse = (challenge: any) =>
      walletChallengeResponse(
        challenge,
        payoutByChallengeId.get(String(challenge._id)) || 0,
        now,
      );

    const deliveryEarnings = Math.round(
      orders.reduce(
        (sum: number, order: any) => sum + riderEarningForOrder(order, tillNoonFare),
        0,
      ),
    );
    const challengeBonuses = Math.round(
      bonusEntries
        .filter((entry: any) => entry.type === "challenge_bonus")
        .reduce((sum: number, entry: any) => sum + (Number(entry.amount) || 0), 0),
    );
    const fastDeliveryBonuses = Math.round(
      bonusEntries
        .filter((entry: any) => entry.type === "fast_delivery_bonus")
        .reduce((sum: number, entry: any) => sum + (Number(entry.amount) || 0), 0),
    );
    const transactions = [
      ...orders.map((order: any) => ({
        id: `delivery:${String(order._id)}`,
        type: "delivery",
        amount: riderEarningForOrder(order, tillNoonFare),
        title: order.orderNum ? `Delivery #${order.orderNum}` : "Delivery earning",
        createdAt: new Date(order.createdAt).toISOString(),
        orderId: String(order._id),
      })),
      ...bonusEntries.map((entry: any) => ({
        id: String(entry._id),
        type: entry.type,
        amount: Number(entry.amount) || 0,
        title: entry.title || "Challenge bonus",
        createdAt: new Date(entry.createdAt).toISOString(),
        challengeId: String(entry.challengeId || ""),
        orderId: entry.orderId ? String(entry.orderId) : undefined,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json({
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      deliveryEarnings,
      challengeBonuses,
      fastDeliveryBonuses,
      totalEarnings: deliveryEarnings + challengeBonuses + fastDeliveryBonuses,
      deliveries: orders.length,
      transactions,
      todayChallenge: challengeResponse(syncedDaily),
      weeklyChallenge: challengeResponse(syncedWeekly),
      recentChallenges: recentChallengeDocs.map(challengeResponse),
    });
  } catch (e: any) {
    req.log.error(e, "Could not load rider wallet");
    res.status(500).json({ message: "Could not load rider wallet" });
  }
});

// Earnings summary — aggregated from this rider's delivered orders
router.get("/rider/earnings", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const rider = await findRiderById(riderId);
    if (!rider) return res.status(404).json({ message: "Rider not found" });

    const requestedDate = String(req.query.date || "").trim();
    const dateStart = requestedDate ? pktDateStart(requestedDate) : null;
    if (requestedDate && !dateStart) {
      return res.status(400).json({ message: "date must be a valid YYYY-MM-DD value" });
    }

    const earn = await computeEarnings(
      riderId,
      Number(rider.tillNoonFare) || 0,
      dateStart ? { value: requestedDate, start: dateStart } : undefined,
    );
    const { rating, ratingCount } = await riderRating(rider);

    res.json({
      ...earn,
      rating,
      ratingCount,
      pendingCollection: Number(rider.pendingCollection) || 0,
      unpaidCollection: Number(rider.unpaidCollection) || 0,
    });
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// ── GPS location tracking ──────────────────────────────────────────────────────
// In-memory only (no DB). The customer's order-tracking page reads the public
// endpoint below; locations expire after 90 seconds.
const riderLocations = new Map<
  string,
  { lat: number; lng: number; riderId: string; ts: number }
>();
const LOCATION_TTL_MS = 90_000;

function distanceInMeters(
  firstLat: number,
  firstLng: number,
  secondLat: number,
  secondLng: number,
): number {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(secondLat - firstLat);
  const longitudeDelta = toRadians(secondLng - firstLng);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(firstLat)) *
      Math.cos(toRadians(secondLat)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

function deliveryGeofenceMessage(order: any, riderId: string): string | null {
  const customerLat = toNumOrNull(order.latitude);
  const customerLng = toNumOrNull(order.longitude);
  if (customerLat === null || customerLng === null) {
    return "Customer delivery coordinates are unavailable. Delivery cannot be confirmed.";
  }

  const location = riderLocations.get(String(order._id));
  if (
    !location ||
    location.riderId !== riderId ||
    Date.now() - location.ts > LOCATION_TTL_MS
  ) {
    return "A recent GPS location is required before confirming delivery.";
  }

  const distance = distanceInMeters(
    location.lat,
    location.lng,
    customerLat,
    customerLng,
  );
  if (distance > DELIVERY_GEOFENCE_RADIUS_METERS) {
    return `Move within ${DELIVERY_GEOFENCE_RADIUS_METERS} meters of the customer before confirming delivery.`;
  }
  return null;
}

// Rider pushes GPS coordinates for an active order they own and are delivering.
router.post("/rider/location", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const { orderId, lat, lng } = req.body || {};
    if (!orderId || typeof lat !== "number" || typeof lng !== "number")
      return res.status(400).json({ message: "orderId, lat and lng are required" });
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180)
      return res.status(400).json({ message: "lat/lng out of range" });
    let orderObjectId: ObjectId;
    try {
      orderObjectId = new ObjectId(String(orderId));
    } catch {
      return res.status(400).json({ message: "Invalid order id" });
    }
    // Only the assigned rider may publish a location, and only while the order
    // is in transit ("Rider Picked Up"). Prevents spoofing other orders.
    const order = await ordersCol().findOne({
      _id: orderObjectId,
      riderId,
      status: "Rider Picked Up",
    });
    if (!order)
      return res
        .status(403)
        .json({ message: "Order is not assigned to you or not in transit" });
    riderLocations.set(String(orderId), { lat, lng, riderId, ts: Date.now() });
    res.json({ ok: true });
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// ── Live demand heatmap ──────────────────────────────────────────────────────
// Returns pre-computed demand-score zones filtered to the rider's own city.
// The cache is refreshed every 2 minutes by heatmapService.startHeatmapScheduler().
router.get("/rider/heatmap", async (req: any, res: any) => {
  try {
    const riderId = requireRiderId(req, res);
    if (!riderId) return;
    const rider = await findRiderById(riderId);
    const city: string | undefined = rider?.city ?? undefined;
    const snapshot = getHeatmapSnapshot(city);
    res.json({ ...snapshot, riderCity: city ?? null });
  } catch (e: any) {
    req.log.error(e);
    res.status(500).json({ message: e.message });
  }
});

// Public — customer's tracking page reads the rider's current location
router.get("/orders/:orderId/rider-location", (req: any, res: any) => {
  const loc = riderLocations.get(String(req.params.orderId));
  if (!loc || Date.now() - loc.ts > LOCATION_TTL_MS)
    return res.status(404).json({ message: "No recent location" });
  res.json({ lat: loc.lat, lng: loc.lng, ts: loc.ts });
});

function toNum(v: any): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function toNumOrNull(v: any): number | null {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** Formats a Date as "04:15 pm" in PKT (UTC+5, no DST). */
function pktTimeString(d: Date): string {
  const pkt = new Date(d.getTime() + 5 * 60 * 60 * 1000);
  let h = pkt.getUTCHours();
  const m = pkt.getUTCMinutes();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ampm}`;
}

function fmtTime(v: any): string | null {
  if (!v) return null;
  // Already a formatted time string (e.g. "04:15 pm") — pass through as-is.
  if (typeof v === "string" && /^\d{2}:\d{2} (am|pm)$/i.test(v)) return v;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString();
}

// Parse a deal item name like "Burger Deal (Coleslaw, Drink)" handled on the client.
function normalizeOrder(doc: any, riderFareOverride?: number) {
  const items = Array.isArray(doc.products)
    ? doc.products.map((p: any) => ({
        name: p.productName || p.name || "Item",
        // The ordered count lives in `count`; for single/non-deal products the
        // `quantity` field instead holds the size/variation descriptor
        // (e.g. "Half", "Regular", "12 Pcs"), so it must not be used as the count.
        quantity: Number(p.count) || 1,
        price: toNum(p.price ?? p.net),
        // Original pre-discount price. When actualPrice > price the item is discounted.
        actualPrice: toNum(p.actualPrice ?? p.price ?? p.net),
        // For single products: the size/variation string from the `quantity` DB field.
        size:
          p.size ||
          p.variation ||
          (p.type !== "deal" &&
          typeof p.quantity === "string" &&
          p.quantity.trim()
            ? p.quantity.trim()
            : null) ||
          null,
        // For deal products: the deal variant description from the `quantity` DB field
        // (e.g. "1 Small Pizza"). Kept separate from `size` to avoid confusion.
        description:
          p.type === "deal" &&
          typeof p.quantity === "string" &&
          p.quantity.trim()
            ? p.quantity.trim()
            : null,
        type: p.type || null,
        // selectedFlavours in MongoDB: [{flavour: string, size: string}]
        dealItems: Array.isArray(p.selectedFlavours)
          ? p.selectedFlavours.map((f: any) => ({
              flavour: f.flavour || f.option || null,
              size: f.size || null,
            }))
          : [],
      }))
    : [];
  const total = toNum(doc.orderTotal);
  // The rider's pay shown for an order is their CURRENT tillNoonFare (passed in as
  // riderFareOverride from the rider's users-collection doc). It takes precedence
  // over the per-order snapshot; the stored snapshot (riderFare) is only a fallback
  // for riders with no tillNoonFare. Never use deliveryCharges (customer charge).
  const snapshot = toNum(doc.riderFare);
  const override =
    typeof riderFareOverride === "number" && riderFareOverride > 0
      ? riderFareOverride
      : 0;
  const riderFare = override > 0 ? override : snapshot;
  // Subtotal = sum of p.net across all products as stored in the DB.
  const rawProducts: any[] = Array.isArray(doc.products) ? doc.products : [];
  const itemsTotal = rawProducts.reduce(
    (s: number, p: any) => s + toNum(p.net),
    0
  );
  // Cash collect amount = orderTotal − sum(p.actualPrice × count).
  // Used for collectAmount display and pendingCollection increments on delivery.
  const actualPriceTotal = rawProducts.reduce(
    (s: number, p: any) =>
      s + toNum(p.actualPrice ?? p.price ?? p.net) * (Number(p.count) || 1),
    0
  );
  return {
    id: String(doc._id),
    restaurantName: doc.martName || null,
    address: doc.address || null,
    latitude: toNumOrNull(doc.latitude),
    longitude: toNumOrNull(doc.longitude),
    martLatitude: toNumOrNull(doc.martLatitude),
    martLongitude: toNumOrNull(doc.martLongitude),
    phone: doc.phone || null,
    status: doc.status,
    total,
    // Customer-facing delivery charge on the bill — NOT the rider's pay (riderFare).
    deliveryFee: toNum(doc.deliveryCharges),
    riderFare,
    // Items sum (actualPrice × qty) shown as "Subtotal" in order detail.
    subtotal: itemsTotal,
    items,
    userName: doc.name || null,
    city: doc.city || null,
    zone: doc.zone || null,
    distance: doc.distance != null && doc.distance !== "" ? String(doc.distance) : null,
    martAddress: doc.martAddress || null,
    martPhone: doc.martPhone || null,
    paymentType: doc.paymentType || doc.paymentMethod || null,
    billingMode: doc.billingMode || null,
    collectAmount: (() => {
      const payType = String(
        doc.paymentType || doc.paymentMethod || ""
      ).toLowerCase();
      const isCodOrder = COD_TYPES.some((t) => t.toLowerCase() === payType);
      if (doc.billingMode === "prepaid" && isCodOrder)
        return Math.max(total - actualPriceTotal, 0);
      return isCodOrder ? total : 0;
    })(),
    orderNum: doc.orderNum != null ? String(doc.orderNum) : null,
    comment: doc.comment || null,
    tip: toNum(doc.tip),
    discount: toNum(doc.discount),
    platformFee: toNum(doc.platformFee),
    vatAmount: toNum(doc.vatAmount),
    paidToRider: !!doc.paidToRider,
    actions: Array.isArray(doc.actions)
      ? doc.actions.map((a: any) => ({
          action: a.action || a.name || "",
          time: a.time || "",
          name: a.name || "",
        }))
      : [],
    acceptedTime: fmtTime(doc.acceptedTime),
    pickUpTime: fmtTime(doc.pickUpTime),
    timeWhenDelivered: fmtTime(doc.timeWhenDelivered),
    createdAt: fmtTime(doc.createdAt) || String(doc.createdAt),
    updatedAt: fmtTime(doc.updatedAt),
    riderId: doc.riderId || null,
    riderName: doc.riderName || null,
    riderArrived: !!doc.riderArrived,
  };
}

// ---------------------------------------------------------------------------
// Chat routes
// The `chats` collection stores one document per order:
//   { _id, orderId, riderId, userId, chat: [{ _id, name, type, txt, time, createdAt, read }] }
// We map:
//   type "user"  → fromRole "customer"
//   type "rider" → fromRole "rider"
//   txt          → text
//   _id          → id (string)
// ---------------------------------------------------------------------------

function legacyChatMessageId(m: any, index = 0): string {
  const identity = [
    "legacy",
    m.type ?? m.fromRole ?? "customer",
    m.createdAt ?? m.time ?? "",
    m.txt ?? m.text ?? "",
    index,
  ].join("\u0000");
  return `legacy:${crypto.createHash("sha256").update(identity).digest("hex")}`;
}

function mapChatMsg(m: any, index = 0) {
  const messageId = m._id ?? m.id;
  return {
    // Older customer-app messages have no _id. Their fallback must remain
    // stable across polls, otherwise the rider app treats the same message as
    // newly arrived every time it refreshes and repeats the notification.
    id: messageId ? String(messageId) : legacyChatMessageId(m, index),
    fromRole: m.type === "rider" ? "rider" : "customer",
    text: m.txt ?? m.text ?? "",
    time: m.time ?? "",
    createdAt: m.createdAt ?? null,
    read: !!m.read,
  };
}

async function requireAssignedChatOrder(
  orderId: string,
  riderId: string,
  res: any,
): Promise<boolean> {
  let orderObjectId: ObjectId;
  try {
    orderObjectId = new ObjectId(orderId);
  } catch {
    res.status(400).json({ message: "Invalid orderId" });
    return false;
  }

  const order = await ordersCol().findOne({
    _id: orderObjectId,
    riderId,
  } as any);
  if (!order) {
    res.status(403).json({ message: "Not authorized" });
    return false;
  }
  return true;
}

// GET /api/orders/:orderId/chat
router.get("/orders/:orderId/chat", async (req, res) => {
  const riderId = requireRiderId(req, res);
  if (!riderId) return;

  const { orderId } = req.params;
  try {
    if (!(await requireAssignedChatOrder(orderId, riderId, res))) return;

    const doc = await chatsCol().findOne({ orderId } as any);
    const msgs = Array.isArray(doc?.chat)
      ? doc.chat.map((m: any, index: number) => mapChatMsg(m, index))
      : [];
    res.json(msgs);
  } catch (err) {
    console.error("GET /api/orders/:orderId/chat error", err);
    res.status(500).json({ message: "Failed to fetch chat" });
  }
});

// POST /api/orders/:orderId/chat
router.post("/orders/:orderId/chat", async (req, res) => {
  const riderId = requireRiderId(req, res);
  if (!riderId) return;

  const { orderId } = req.params;
  const text = String(req.body?.text ?? "").trim();
  if (!text) {
    res.status(400).json({ message: "text is required" });
    return;
  }

  try {
    if (!(await requireAssignedChatOrder(orderId, riderId, res))) return;

    // Find the rider's name for the message
    const rider = await findRiderById(riderId);
    const name = rider?.name ?? "Rider";

    const { ObjectId: ObjId } = await import("mongodb");
    const newMsg = {
      _id: new ObjId(),
      name,
      type: "rider",
      txt: text,
      time: new Date().toLocaleTimeString("en-PK", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Karachi",
      }),
      createdAt: new Date().toISOString(),
      read: false,
    };

    // Upsert: create the chat doc if it doesn't exist yet
    await chatsCol().updateOne(
      { orderId } as any,
      {
        $push: { chat: newMsg } as any,
        $setOnInsert: { orderId, riderId, createdAt: new Date().toISOString() },
      },
      { upsert: true },
    );

    res.json(mapChatMsg(newMsg));
  } catch (err) {
    console.error("POST /api/orders/:orderId/chat error", err);
    res.status(500).json({ message: "Failed to send message" });
  }
});

// PATCH /api/orders/:orderId/chat/read
// Marks all customer messages (type "user") in the chat as read.
// Only the rider assigned to the order may call this.
router.patch("/orders/:orderId/chat/read", async (req, res) => {
  const riderId = requireRiderId(req, res);
  if (!riderId) return;

  const { orderId } = req.params;
  try {
    if (!(await requireAssignedChatOrder(orderId, riderId, res))) return;

    await chatsCol().updateOne(
      { orderId } as any,
      { $set: { "chat.$[elem].read": true } } as any,
      { arrayFilters: [{ "elem.type": "user" }] },
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("PATCH /api/orders/:orderId/chat/read error", err);
    res.status(500).json({ message: "Failed to mark messages as read" });
  }
});

// ---------------------------------------------------------------------------
// Save OneSignal subscription (player) ID
// ---------------------------------------------------------------------------
router.post("/rider/player-id", async (req, res) => {
  const riderId = requireRiderId(req, res);
  if (!riderId) return;
  const { playerId } = req.body as { playerId?: string };
  if (!playerId || typeof playerId !== "string") {
    return res.status(400).json({ message: "playerId is required" });
  }
  try {
    await usersCol().updateOne(
      { _id: new ObjectId(riderId) } as any,
      { $set: { playerId } },
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/rider/player-id error", err);
    return res.status(500).json({ message: "Failed to save playerId" });
  }
});

// ---------------------------------------------------------------------------
// Version check
// ---------------------------------------------------------------------------
const IOS_VERSIONS = [
  "2.0",
  "3.0",
  "4.3.0",
  "4.6.0",
  "4.6.1",
  "4.6.2",
  "4.6.3",
  "4.6.4",
];
const ANDROID_VERSIONS = [
  "4.3.0",
  "4.5.0",
  "4.6.0",
  "4.6.1",
  "4.6.2",
  "4.6.3",
  "4.6.4",
];

router.post("/ridersCheckVersion", (req, res) => {
  try {
    const { version, platform } = req.body as { version?: string; platform?: string };

    if (platform === "ios" && IOS_VERSIONS.includes(version ?? "")) {
      return res.json({ status: "200" });
    }

    if (platform === "android" && ANDROID_VERSIONS.includes(version ?? "")) {
      return res.json({ status: "200" });
    }

    return res.json({
      status: "404",
      msg: "A new update is now available. kindly update your App to get the best experience.",
    });
  } catch (err) {
    console.error("POST /ridersCheckVersion error", err);
    return res.json({
      status: "404",
      msg: "Looks like something went wrong on our side. Sorry for the inconvenience.",
      error: String(err),
    });
  }
});

export default router;
