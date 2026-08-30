import React from 'react';
import {
  Wallet,
  CheckCircle2,
  Clock,
  Zap,
  Banknote,
  Gift,
  AlertCircle,
  RefreshCcw,
  Target,
  TrendingUp,
  Flame,
  History
} from 'lucide-react';

export type ChallengeStatus = 'active' | 'completed' | 'expired';
export type ChallengePayoutStatus = 'in_progress' | 'pending' | 'paid' | 'not_earned';

export interface Challenge {
  id?: string;
  kind: 'daily' | 'weekly' | string;
  tier: string;
  target: number;
  progress: number;
  reward: number;
  milestones?: Array<{
    target: number;
    reward: number;
    earned: boolean;
    cumulativeTarget?: number;
  }>;
  milestoneScale?: Array<{
    target: number;
    reward: number;
    earned: boolean;
    cumulativeTarget?: number;
  }>;
  cumulativeProgress?: number;
  status: ChallengeStatus;
  payoutStatus: ChallengePayoutStatus;
  bonusAmount: number;
  periodDeliveries: number;
  periodStart: string | Date;
  periodEnd: string | Date;
}

export interface Transaction {
  id?: string;
  type: 'delivery' | 'challenge_bonus' | 'fast_delivery_bonus';
  amount: number;
  title: string;
  createdAt: string | Date;
  orderId?: string;
}

export interface WeeklyEarningsSummary {
  weekStart: string | Date;
  weekEnd: string | Date;
  deliveryEarnings: number;
  challengeBonuses: number;
  fastDeliveryBonuses: number;
  totalEarnings: number;
  deliveries: number;
}

export interface WalletOverviewProps {
  loading?: boolean;
  error?: string | boolean;
  deliveryEarnings?: number;
  challengeBonuses?: number;
  fastDeliveryBonuses?: number;
  totalEarnings?: number;
  deliveries?: number;
  weekStart?: string | Date;
  weekEnd?: string | Date;
  previousWeek?: WeeklyEarningsSummary;
  dailyChallenge?: Challenge | null;
  weeklyChallenge?: Challenge | null;
  recentChallenges?: Challenge[];
  transactions?: Transaction[];
  onRetry?: () => void;
}

const formatDate = (date?: string | Date) => {
  if (!date) return '';
  const d = new Date(date);
  return new Intl.DateTimeFormat('en-PK', { timeZone: 'Asia/Karachi', month: 'short', day: 'numeric' }).format(d);
};

const formatTime = (date?: string | Date) => {
  if (!date) return '';
  const d = new Date(date);
  return new Intl.DateTimeFormat('en-PK', { timeZone: 'Asia/Karachi', hour: 'numeric', minute: '2-digit' }).format(d);
};

const formatChallengePeriod = (challenge: Challenge) => {
  const dateOptions: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Karachi',
    month: 'short',
    day: 'numeric',
  };
  const formatter = new Intl.DateTimeFormat('en-PK', dateOptions);
  const start = new Date(challenge.periodStart);
  const end = new Date(new Date(challenge.periodEnd).getTime() - 1);
  const startLabel = formatter.format(start);
  const endLabel = formatter.format(end);

  return startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;
};

const formatWeekRange = (summary: WeeklyEarningsSummary) => {
  const end = new Date(new Date(summary.weekEnd).getTime() - 1);
  return `${formatDate(summary.weekStart)} - ${formatDate(end)}`;
};

const WalletSkeleton = () => (
  <div className="flex flex-col gap-8 pb-24 max-w-md mx-auto w-full animate-pulse px-4 pt-6">
    <div className="h-56 bg-muted/60 rounded-3xl w-full"></div>
    
    <div className="space-y-4">
      <div className="h-6 w-36 bg-muted/60 rounded-md"></div>
      <div className="h-44 bg-muted/40 rounded-2xl w-full"></div>
      <div className="h-44 bg-muted/40 rounded-2xl w-full"></div>
    </div>
    
    <div className="space-y-4">
      <div className="h-6 w-44 bg-muted/60 rounded-md"></div>
      <div className="h-36 bg-muted/40 rounded-2xl w-full"></div>
      <div className="h-36 bg-muted/40 rounded-2xl w-full"></div>
    </div>

    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="h-6 w-40 bg-muted/60 rounded-md"></div>
        <div className="h-4 w-16 bg-muted/60 rounded-md"></div>
      </div>
      <div className="h-20 bg-muted/40 rounded-2xl w-full"></div>
      <div className="h-20 bg-muted/40 rounded-2xl w-full"></div>
      <div className="h-20 bg-muted/40 rounded-2xl w-full"></div>
    </div>
  </div>
);

const WalletError = ({ error, onRetry }: { error: any, onRetry?: () => void }) => (
  <div className="flex flex-col items-center justify-center p-8 text-center h-[60vh] gap-4 max-w-md mx-auto w-full">
    <div className="p-4 bg-destructive/10 rounded-full text-destructive mb-2">
      <AlertCircle className="w-8 h-8" />
    </div>
    <div>
      <h3 className="font-bold text-lg mb-1 text-foreground">Unable to load earnings</h3>
      <p className="text-muted-foreground text-sm max-w-[250px]">
        {typeof error === 'string' ? error : 'Please check your connection and try again.'}
      </p>
    </div>
    {onRetry && (
      <button 
        onClick={onRetry}
        className="flex items-center gap-2 px-6 py-2.5 mt-2 bg-primary text-primary-foreground rounded-xl font-medium hover:opacity-90 active:scale-95 transition-all shadow-sm shadow-primary/20"
      >
        <RefreshCcw className="w-4 h-4" />
        Retry
      </button>
    )}
  </div>
);

type DisplayMilestone = {
  target: number;
  reward: number;
  earned: boolean;
  cumulativeTarget?: number;
};

const getMilestoneThreshold = (milestone: DisplayMilestone) =>
  Number.isFinite(milestone.cumulativeTarget) && milestone.cumulativeTarget! > 0
    ? milestone.cumulativeTarget!
    : milestone.target;

const getDisplayMilestones = (challenge: Challenge): DisplayMilestone[] => {
  const milestones = challenge.milestoneScale?.length
    ? challenge.milestoneScale
    : challenge.milestones?.length
      ? challenge.milestones
      : [{
          target: challenge.target,
          reward: challenge.reward,
          earned: challenge.progress >= challenge.target,
        }];

  return milestones.map((milestone) => ({
    ...milestone,
    cumulativeTarget: getMilestoneThreshold(milestone),
  }));
};

const getCumulativeProgress = (challenge: Challenge) => {
  if (Number.isFinite(challenge.cumulativeProgress)) {
    return Math.max(0, challenge.cumulativeProgress!);
  }
  if (Number.isFinite(challenge.periodDeliveries)) {
    return Math.max(0, challenge.periodDeliveries);
  }
  return Math.max(0, challenge.progress);
};

const ChallengeMilestoneBar = ({
  milestones,
  progress,
  colorClass,
  reachedColorClass,
  label,
}: {
  milestones: DisplayMilestone[];
  progress: number;
  colorClass: string;
  reachedColorClass: string;
  label: string;
}) => {
  const finalTarget = getMilestoneThreshold(
    milestones.at(-1) ?? { target: 0, reward: 0, earned: false },
  );
  const percent = finalTarget > 0
    ? Math.min(100, Math.max(0, (progress / finalTarget) * 100))
    : 0;
  const currentMilestoneIndex = milestones.findIndex(
    (milestone) => progress < getMilestoneThreshold(milestone),
  );

  return (
    <div className="pt-8 pb-10" aria-label={label}>
      <div
        className="relative h-3 w-full rounded-full bg-secondary"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={finalTarget}
        aria-valuenow={Math.min(progress, finalTarget)}
      >
        <div
          className={`h-full rounded-full transition-all ${colorClass}`}
          style={{ width: `${percent}%` }}
        />
        {milestones.map((milestone, index) => {
          const threshold = getMilestoneThreshold(milestone);
          const position = finalTarget > 0
            ? Math.min(92, Math.max(8, (threshold / finalTarget) * 100))
            : 8;
          const reached = progress >= threshold;
          const current = index === currentMilestoneIndex;

          return (
            <div
              key={`${milestone.target}-${milestone.reward}-${index}`}
              className="absolute top-1/2 flex w-16 -translate-x-1/2 -translate-y-1/2 flex-col items-center"
              style={{ left: `${position}%` }}
              aria-label={`${milestone.target}-delivery stage at ${threshold} cumulative deliveries, reward Rs. ${milestone.reward.toLocaleString()}, ${reached ? 'reached' : 'upcoming'}`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${
                  reached
                    ? `border-card ${reachedColorClass}`
                    : current
                      ? 'border-primary bg-card text-primary'
                      : 'border-card bg-muted text-muted-foreground'
                }`}
              >
                {reached ? <CheckCircle2 className="h-4 w-4" /> : <Target className="h-3.5 w-3.5" />}
              </span>
              <span className="mt-1 whitespace-nowrap text-[10px] font-bold leading-none text-foreground">
                {milestone.target}
              </span>
              {threshold !== milestone.target && (
                <span className="mt-0.5 whitespace-nowrap text-[9px] font-medium leading-none text-muted-foreground">
                  at {threshold} total
                </span>
              )}
              <span className={`mt-0.5 whitespace-nowrap text-[10px] font-semibold leading-none ${
                reached ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'
              }`}>
                Rs. {milestone.reward.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ChallengeCard = ({ challenge, title, icon: Icon }: { challenge: Challenge, title: string, icon: any }) => {
  const isExpired = challenge.status === 'expired';
  const isPaid = challenge.payoutStatus === 'paid';
  const isPending = challenge.payoutStatus === 'pending';
  const periodInProgress = new Date(challenge.periodEnd).getTime() > Date.now();
  const milestones = getDisplayMilestones(challenge);
  const cumulativeProgress = getCumulativeProgress(challenge);
  const finalTarget = getMilestoneThreshold(
    milestones.at(-1) ?? { target: challenge.target, reward: challenge.reward, earned: false },
  );
  const currentMilestone = milestones.find(
    (milestone) => cumulativeProgress < getMilestoneThreshold(milestone),
  );
  const highestReached = [...milestones]
    .reverse()
    .find((milestone) => cumulativeProgress >= getMilestoneThreshold(milestone));
  const availableReward = Math.max(...milestones.map((milestone) => milestone.reward), challenge.reward);
  const payoutLabel = isPaid
    ? `Bonus paid: Rs. ${challenge.bonusAmount.toLocaleString()}`
    : isPending
      ? 'Bonus pending'
      : challenge.payoutStatus === 'not_earned'
        ? 'No bonus earned'
        : 'In progress';

  return (
    <div className="bg-card text-card-foreground rounded-2xl p-5 border shadow-sm flex flex-col gap-4 relative overflow-hidden transition-all hover:shadow-md">
      {isPaid && (
        <div className="absolute top-0 right-0 w-24 h-24 bg-green-500/10 rounded-bl-full flex items-start justify-end p-4">
          <CheckCircle2 className="w-6 h-6 text-green-600" />
        </div>
      )}
      
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl ${isPaid ? 'bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-400' : 'bg-primary/10 text-primary'}`}>
             <Icon className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</span>
              {challenge.tier && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-semibold">
                  {challenge.tier}
                </span>
              )}
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                {periodInProgress ? 'In progress' : isPaid ? 'Paid' : isPending ? 'Bonus pending' : 'Ended'}
              </span>
            </div>
             <h3 className="font-semibold text-base leading-tight">{finalTarget}-delivery challenge</h3>
          </div>
        </div>
      </div>
      
       <div className="rounded-xl bg-primary/5 border border-primary/10 px-3.5 py-3">
         <div className="flex items-center justify-between gap-3 text-sm">
            <div>
              <span className="block font-semibold text-foreground">
                 Progress: {cumulativeProgress} / {finalTarget} deliveries
              </span>
              <span className="text-xs text-muted-foreground">
                 {highestReached
                   ? `Current reward tier: Rs. ${highestReached.reward.toLocaleString()} at ${highestReached.target} deliveries`
                   : currentMilestone
                     ? `Next reward: Rs. ${currentMilestone.reward.toLocaleString()} at ${getMilestoneThreshold(currentMilestone)} deliveries`
                     : 'No milestone reached yet'}
              </span>
            </div>
             {currentMilestone ? (
             <span className="text-primary font-medium text-right">
                  {Math.max(getMilestoneThreshold(currentMilestone) - cumulativeProgress, 0)} rides to unlock Rs. {currentMilestone.reward.toLocaleString()}
             </span>
           ) : (
               <span className={isPending ? 'text-primary font-medium text-right' : 'text-green-600 dark:text-green-400 font-medium'}>
                  {isPending ? 'Bonus pending' : isPaid ? 'Bonus paid' : 'Highest milestone reached'}
               </span>
           )}
        </div>
      </div>

        <ChallengeMilestoneBar
          milestones={milestones}
          progress={cumulativeProgress}
          colorClass={isPaid ? 'bg-green-500' : 'bg-primary'}
          reachedColorClass={isPaid ? 'bg-green-500 text-white' : 'bg-primary text-primary-foreground'}
          label={`${title}: ${cumulativeProgress} of ${finalTarget} eligible deliveries`}
        />
      
      <div className="flex items-center justify-between text-xs text-muted-foreground pt-3 border-t mt-2">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
           <span>
             {isExpired ? 'Ended' : 'Ends'}{' '}
             {formatDate(new Date(new Date(challenge.periodEnd).getTime() - 1))}
           </span>
        </div>
          {isPaid ? (
             <span className="text-green-600 dark:text-green-400 font-medium">{payoutLabel}</span>
           ) : !isExpired ? (
            <span className="text-primary font-medium text-right">
                Top tier: Rs. {availableReward.toLocaleString()} · only the highest tier pays at period end
            </span>
           ) : (
             <span className="font-medium text-right">{payoutLabel}</span>
           )}
      </div>
    </div>
  );
};

const RecentChallengeCard = ({ challenge }: { challenge: Challenge }) => {
  const isPaid = challenge.payoutStatus === 'paid';
  const isNotEarned = challenge.payoutStatus === 'not_earned';
  const milestones = getDisplayMilestones(challenge);
  const cumulativeProgress = getCumulativeProgress(challenge);
  const finalTarget = getMilestoneThreshold(
    milestones.at(-1) ?? { target: challenge.target, reward: challenge.reward, earned: false },
  );
  const progressPercent = finalTarget > 0
    ? Math.min(100, Math.max(0, (cumulativeProgress / finalTarget) * 100))
    : 0;
  const statusLabel = isPaid ? 'Paid' : isNotEarned ? 'No bonus' : challenge.payoutStatus === 'pending' ? 'Pending' : 'In progress';
  const statusClass = isPaid
    ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400'
    : 'bg-muted text-muted-foreground';

  return (
    <div className="bg-card text-card-foreground rounded-2xl p-4 border shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
           <div className={`p-2.5 rounded-xl shrink-0 ${isPaid ? 'bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}>
             {isPaid ? <CheckCircle2 className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold text-sm">
                {challenge.kind === 'daily' ? 'Daily challenge' : 'Weekly challenge'}
              </h4>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${statusClass}`}>
                {statusLabel}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
                {formatChallengePeriod(challenge)} · {challenge.tier} · Target: {finalTarget}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
           <p className={`font-bold text-sm ${isPaid ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
             {isPaid ? `+Rs. ${challenge.bonusAmount.toLocaleString()}` : isNotEarned ? 'No bonus earned' : 'Bonus pending'}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
             {isPaid ? 'Bonus paid' : isNotEarned ? 'Period result' : 'Awaiting settlement'}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-foreground">
              {cumulativeProgress} eligible deliveries
          </span>
          <span className="text-muted-foreground">{Math.round(progressPercent)}%</span>
        </div>
        <ChallengeMilestoneBar
          milestones={milestones}
          progress={cumulativeProgress}
          colorClass={isPaid ? 'bg-green-500' : 'bg-muted-foreground'}
          reachedColorClass={isPaid ? 'bg-green-500 text-white' : 'bg-muted-foreground text-white'}
          label={`${challenge.kind === 'daily' ? 'Daily' : 'Weekly'} challenge: ${cumulativeProgress} of ${finalTarget} eligible deliveries`}
        />
      </div>
    </div>
  );
};

const TransactionItem = ({ tx }: { tx: Transaction }) => {
  const isBonus = tx.type !== 'delivery';
  return (
    <div className="flex items-center justify-between p-4 bg-card rounded-2xl border shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3.5">
        <div className={`p-3 rounded-2xl ${isBonus ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400' : 'bg-primary/10 text-primary'}`}>
          {isBonus ? <Zap className="w-5 h-5" /> : <Banknote className="w-5 h-5" />}
        </div>
        <div>
          <p className="font-semibold text-sm text-foreground">{tx.title}</p>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
            <span>{formatDate(tx.createdAt)}</span>
            <span className="w-1 h-1 rounded-full bg-muted-foreground/30"></span>
            <span>{formatTime(tx.createdAt)}</span>
            {tx.orderId && (
              <>
                <span className="w-1 h-1 rounded-full bg-muted-foreground/30"></span>
                <span className="font-mono text-muted-foreground/80">#{tx.orderId.slice(-4)}</span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="text-right flex flex-col items-end">
        <span className="font-bold text-sm text-foreground">+Rs. {tx.amount.toLocaleString()}</span>
        {isBonus && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500 mt-0.5">Bonus</span>
        )}
      </div>
    </div>
  );
};

const PreviousWeekEarningsCard = ({ summary }: { summary?: WeeklyEarningsSummary }) => {
  if (!summary) return null;

  const totalBonuses = summary.challengeBonuses + summary.fastDeliveryBonuses;

  return (
    <section className="px-4">
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="shrink-0 rounded-xl bg-primary/10 p-2.5 text-primary">
              <History className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm">Previous week's earnings</h3>
              <p className="mt-1 text-xs text-muted-foreground">{formatWeekRange(summary)}</p>
            </div>
          </div>
          <p className="shrink-0 text-xl font-bold text-foreground">
            Rs. {summary.totalEarnings.toLocaleString()}
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-muted/60 p-3">
            <p className="text-[11px] font-semibold text-muted-foreground">Deliveries</p>
            <p className="mt-1 text-sm font-bold">Rs. {summary.deliveryEarnings.toLocaleString()}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{summary.deliveries} completed</p>
          </div>
          <div className="rounded-xl bg-muted/60 p-3">
            <p className="text-[11px] font-semibold text-muted-foreground">Bonuses</p>
            <p className="mt-1 text-sm font-bold">Rs. {totalBonuses.toLocaleString()}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Challenges + fast delivery</p>
          </div>
        </div>
      </div>
    </section>
  );
};

export function WalletOverview({
  loading,
  error,
  deliveryEarnings = 0,
  challengeBonuses = 0,
  fastDeliveryBonuses = 0,
  totalEarnings = 0,
  deliveries = 0,
  weekStart,
  weekEnd,
  previousWeek,
  dailyChallenge,
  weeklyChallenge,
  recentChallenges = [],
  transactions = [],
  onRetry
}: WalletOverviewProps) {
  
  if (loading) {
    return <WalletSkeleton />;
  }

  if (error) {
    return <WalletError error={error} onRetry={onRetry} />;
  }

  const recentChallengeHistory = recentChallenges.filter((challenge) => challenge.status !== 'active');
  const totalBonuses = challengeBonuses + fastDeliveryBonuses;

  return (
    <div className="flex flex-col gap-8 pb-24 max-w-md mx-auto w-full">
      
      {/* Earnings Hero */}
      <section className="px-4 pt-6">
        <div className="relative rounded-3xl overflow-hidden bg-primary text-primary-foreground p-6 shadow-xl shadow-primary/20">
          {/* Abstract background elements */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-black/10 rounded-full blur-2xl translate-y-1/3 -translate-x-1/4"></div>
          
          <div className="relative z-10">
            <div className="flex justify-between items-start mb-8">
              <div>
                <div className="flex items-center gap-1.5 text-primary-foreground/80 text-sm font-medium mb-1">
                  <Clock className="w-4 h-4" />
                  <span>{weekStart && weekEnd ? `${formatDate(weekStart)} - ${formatDate(weekEnd)}` : 'Current Week'}</span>
                </div>
                <h2 className="text-4xl font-bold tracking-tight">Rs. {totalEarnings.toLocaleString()}</h2>
              </div>
              <div className="p-2.5 bg-white/15 rounded-2xl backdrop-blur-md">
                <Wallet className="w-6 h-6 text-white" />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-black/10 rounded-2xl p-4 backdrop-blur-sm border border-white/5">
                <div className="flex items-center gap-1.5 text-primary-foreground/80 text-xs font-medium mb-1.5">
                  <TrendingUp className="w-3.5 h-3.5" /> Deliveries
                </div>
                <p className="text-xl font-bold">Rs. {deliveryEarnings.toLocaleString()}</p>
                <p className="text-xs text-primary-foreground/60 mt-0.5">{deliveries} trips</p>
              </div>
              <div className="bg-black/10 rounded-2xl p-4 backdrop-blur-sm border border-white/5">
                <div className="flex items-center gap-1.5 text-primary-foreground/80 text-xs font-medium mb-1.5">
                  <Gift className="w-3.5 h-3.5" /> Bonuses
                </div>
                <p className="text-xl font-bold">Rs. {totalBonuses.toLocaleString()}</p>
                <p className="text-xs text-primary-foreground/60 mt-0.5">
                  Challenges Rs. {challengeBonuses.toLocaleString()} · Fast Rs. {fastDeliveryBonuses.toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {previousWeek && <PreviousWeekEarningsCard summary={previousWeek} />}

      {/* Active Challenges */}
      <section className="px-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            Active Challenges
          </h3>
        </div>
        
        <div className="flex flex-col gap-4">
          {dailyChallenge && <ChallengeCard challenge={dailyChallenge} title="Daily Quest" icon={Flame} />}
          {weeklyChallenge && <ChallengeCard challenge={weeklyChallenge} title="Weekly Sprint" icon={Zap} />}
          
          {(!dailyChallenge && !weeklyChallenge) && (
            <div className="text-center p-8 bg-card rounded-2xl border border-dashed flex flex-col items-center">
              <Target className="w-10 h-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-foreground">No active challenges</p>
              <p className="text-xs text-muted-foreground mt-1 text-balance">Check back later for new earning opportunities.</p>
            </div>
          )}
        </div>
      </section>

      {/* Recent Challenge History */}
      <section className="px-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <History className="w-5 h-5 text-primary" />
            Recent challenge results
          </h3>
        </div>

        <div className="flex flex-col gap-3">
          {recentChallengeHistory.map((challenge) => (
            <RecentChallengeCard key={challenge.id || `${challenge.kind}-${challenge.periodStart}`} challenge={challenge} />
          ))}

          {recentChallengeHistory.length === 0 && (
            <div className="text-center p-7 bg-card rounded-2xl border border-dashed flex flex-col items-center">
              <History className="w-9 h-9 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-foreground">No recent challenge results</p>
              <p className="text-xs text-muted-foreground mt-1 text-balance">Completed and expired challenges will appear here.</p>
            </div>
          )}
        </div>
      </section>

      {/* Recent Transactions */}
      <section className="px-4 flex flex-col gap-4">
        <div className="flex items-center">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <History className="w-5 h-5 text-primary" />
            This Week's Activity
          </h3>
        </div>
        
        <div className="flex flex-col gap-3">
          {transactions.map((tx, idx) => (
            <TransactionItem key={tx.id || idx} tx={tx} />
          ))}
          
          {transactions.length === 0 && (
            <div className="text-center p-8 bg-card rounded-2xl border border-dashed flex flex-col items-center">
              <History className="w-10 h-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-foreground">No recent transactions</p>
              <p className="text-xs text-muted-foreground mt-1 text-balance">Completed deliveries will appear here.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
