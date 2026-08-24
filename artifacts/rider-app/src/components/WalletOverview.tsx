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

export interface Challenge {
  kind: 'daily' | 'weekly' | string;
  tier: string;
  target: number;
  progress: number;
  reward: number;
  status: ChallengeStatus;
  periodStart: string | Date;
  periodEnd: string | Date;
}

export interface Transaction {
  id?: string;
  type: 'delivery' | 'challenge_bonus';
  amount: number;
  title: string;
  createdAt: string | Date;
  orderId?: string;
}

export interface WalletOverviewProps {
  loading?: boolean;
  error?: string | boolean;
  deliveryEarnings?: number;
  challengeBonuses?: number;
  totalEarnings?: number;
  deliveries?: number;
  weekStart?: string | Date;
  weekEnd?: string | Date;
  dailyChallenge?: Challenge | null;
  weeklyChallenge?: Challenge | null;
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

const WalletSkeleton = () => (
  <div className="flex flex-col gap-8 pb-24 max-w-md mx-auto w-full animate-pulse px-4 pt-6">
    <div className="h-56 bg-muted/60 rounded-3xl w-full"></div>
    
    <div className="space-y-4">
      <div className="h-6 w-36 bg-muted/60 rounded-md"></div>
      <div className="h-44 bg-muted/40 rounded-2xl w-full"></div>
      <div className="h-44 bg-muted/40 rounded-2xl w-full"></div>
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

const ChallengeCard = ({ challenge, title, icon: Icon }: { challenge: Challenge, title: string, icon: any }) => {
  const isCompleted = challenge.status === 'completed';
  const isExpired = challenge.status === 'expired';
  
  const progressPercent = Math.min(100, Math.max(0, (challenge.progress / challenge.target) * 100));

  return (
    <div className="bg-card text-card-foreground rounded-2xl p-5 border shadow-sm flex flex-col gap-4 relative overflow-hidden transition-all hover:shadow-md">
      {isCompleted && (
        <div className="absolute top-0 right-0 w-24 h-24 bg-green-500/10 rounded-bl-full flex items-start justify-end p-4">
          <CheckCircle2 className="w-6 h-6 text-green-600" />
        </div>
      )}
      
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl ${isCompleted ? 'bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-400' : 'bg-primary/10 text-primary'}`}>
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
            </div>
            <h3 className="font-semibold text-base leading-tight">Complete {challenge.target} deliveries</h3>
          </div>
        </div>
      </div>
      
      <div className="space-y-2 mt-1">
        <div className="flex justify-between text-sm font-medium">
          <span className="text-muted-foreground">{challenge.progress} / {challenge.target} trips</span>
          <span className={isCompleted ? "text-green-600 font-bold" : "text-foreground font-bold"}>
            +Rs. {challenge.reward.toLocaleString()}
          </span>
        </div>
        <div className="h-2.5 w-full bg-secondary rounded-full overflow-hidden">
          <div 
            className={`h-full rounded-full transition-all duration-1000 ease-out ${
              isCompleted ? 'bg-green-500' : isExpired ? 'bg-muted-foreground' : 'bg-primary'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
      
      <div className="flex items-center justify-between text-xs text-muted-foreground pt-3 border-t mt-2">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          <span>{isExpired ? 'Ended' : 'Ends'} {formatDate(challenge.periodEnd)}</span>
        </div>
        {!isCompleted && !isExpired && (
          <span className="text-primary font-medium">{challenge.target - challenge.progress} more to go!</span>
        )}
        {isCompleted && <span className="text-green-600 font-medium">Reward earned!</span>}
      </div>
    </div>
  );
};

const TransactionItem = ({ tx }: { tx: Transaction }) => {
  const isBonus = tx.type === 'challenge_bonus';
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

export function WalletOverview({
  loading,
  error,
  deliveryEarnings = 0,
  challengeBonuses = 0,
  totalEarnings = 0,
  deliveries = 0,
  weekStart,
  weekEnd,
  dailyChallenge,
  weeklyChallenge,
  transactions = [],
  onRetry
}: WalletOverviewProps) {
  
  if (loading) {
    return <WalletSkeleton />;
  }

  if (error) {
    return <WalletError error={error} onRetry={onRetry} />;
  }

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
                <p className="text-xl font-bold">Rs. {challengeBonuses.toLocaleString()}</p>
                <p className="text-xs text-primary-foreground/60 mt-0.5">Challenges</p>
              </div>
            </div>
          </div>
        </div>
      </section>

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
