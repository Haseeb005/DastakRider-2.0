import { useState, useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetRiderMe,
  getGetRiderMeQueryKey,
  useRegisterRider,
  useLoginRider,
  useLogoutRider,
  useUpdateRiderAvailability,
  useGetAvailableOrders,
  getGetAvailableOrdersQueryKey,
  useGetActiveOrders,
  getGetActiveOrdersQueryKey,
  useGetOrderHistory,
  getGetOrderHistoryQueryKey,
  useAcceptOrder,
  useUpdateOrderStatus,
  useMarkOrderArrived,
  useGetRiderEarnings,
  getGetRiderEarningsQueryKey,
  usePushRiderLocation,
  type Rider,
  type RiderOrder,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Bike,
  Package,
  CheckCircle,
  MapPin,
  LogOut,
  User,
  TrendingUp,
  History,
  Phone,
  Navigation,
  CircleDot,
  RefreshCw,
  Star,
  Wallet,
  Power,
  Bell,
  X,
  Clock,
  CreditCard,
  Banknote,
  Volume2,
  Store,
  Receipt,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type RiderView = "available" | "active" | "history" | "profile";
type AuthView = "login" | "register";

// ── Utilities ─────────────────────────────────────────────────────────────────
// Real Dastak order status flow:
//   Pending → Rider Accepted → Rider Picked Up → Delivered  (or Rejected)

const STATUS_LABELS: Record<string, string> = {
  Pending: "Waiting Pickup",
  "Rider Accepted": "Accepted",
  "Rider Picked Up": "On the Way",
  Delivered: "Delivered",
  Rejected: "Rejected",
};

const STATUS_COLORS: Record<string, string> = {
  Pending: "bg-yellow-100 text-yellow-800",
  "Rider Accepted": "bg-blue-100 text-blue-800",
  "Rider Picked Up": "bg-purple-100 text-purple-800",
  Delivered: "bg-green-100 text-green-800",
  Rejected: "bg-red-100 text-red-800",
};

function formatMoney(v: number | string | undefined) {
  return `Rs. ${parseFloat(String(v || 0)).toFixed(0)}`;
}

function timeAgo(dateStr?: string) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const CITIES = [
  "Lahore",
  "Karachi",
  "Islamabad",
  "Rawalpindi",
  "Faisalabad",
  "Multan",
  "Peshawar",
  "Quetta",
  "Sargodha",
];

// Parse a deal item name like "Burger Deal (Coleslaw, Small Drink, Fries)" into a
// base name + the list of selections inside the parentheses.
function parseItemName(fullName: string): { baseName: string; selections: string[] } {
  const match = fullName.match(/^(.*?)\s*\((.+)\)\s*$/);
  if (match) {
    return {
      baseName: match[1].trim(),
      selections: match[2].split(",").map((s) => s.trim()).filter(Boolean),
    };
  }
  return { baseName: fullName, selections: [] };
}

function formatDateTime(dateStr?: string | null) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleString("en-PK", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ── New-order alert: Web Audio arpeggio + browser notification ──────────────────
// Plays an ascending E-major arpeggio (E5 → G5 → B5 → E6) for ~10 seconds.
function playOrderAlert(): () => void {
  const AudioCtx =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return () => {};
  let ctx: AudioContext;
  try {
    ctx = new AudioCtx();
  } catch {
    return () => {};
  }
  const melody = [
    { freq: 659, dur: 0.1 }, // E5
    { freq: 784, dur: 0.1 }, // G5
    { freq: 988, dur: 0.1 }, // B5
    { freq: 1319, dur: 0.2 }, // E6
  ];
  const cycleLen = melody.reduce((s, n) => s + n.dur, 0) + 0.2;
  const cycles = Math.ceil(10 / cycleLen);
  let t = ctx.currentTime + 0.05;
  for (let c = 0; c < cycles; c++) {
    melody.forEach((note, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i % 2 === 0 ? "triangle" : "sine";
      osc.frequency.value = note.freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + note.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + note.dur + 0.02);
      t += note.dur;
    });
    t += 0.2;
  }
  const stopAt = (t + 0.3) * 1000 - ctx.currentTime * 1000;
  const timer = setTimeout(() => ctx.close().catch(() => {}), Math.max(stopAt, 0));
  return () => {
    clearTimeout(timer);
    ctx.close().catch(() => {});
  };
}

// Tracks seen order IDs; alerts (sound + notification) when genuinely new ones appear.
function useOrderAlert(orders: RiderOrder[], isOnline: boolean) {
  const seen = useRef<Set<string>>(new Set());
  const seeded = useRef(false);
  const stopFn = useRef<(() => void) | null>(null);
  const [newCount, setNewCount] = useState(0);

  const stopAlert = () => {
    stopFn.current?.();
    stopFn.current = null;
    setNewCount(0);
  };

  useEffect(() => {
    if (!isOnline) return;
    const ids = orders.map((o) => o.id);
    if (!seeded.current) {
      seen.current = new Set(ids);
      seeded.current = true;
      return;
    }
    const fresh = ids.filter((id) => !seen.current.has(id));
    if (fresh.length > 0) {
      fresh.forEach((id) => seen.current.add(id));
      setNewCount((n) => n + fresh.length);
      stopFn.current?.();
      stopFn.current = playOrderAlert();
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("New delivery order!", {
            body: `${fresh.length} new order${fresh.length > 1 ? "s" : ""} available to pick up.`,
          });
        } catch {
          /* ignore */
        }
      }
    }
    // Drop IDs that are no longer available so they can re-alert if they return.
    seen.current.forEach((id) => {
      if (!ids.includes(id)) seen.current.delete(id);
    });
  }, [orders, isOnline]);

  // Reset seeding when going offline so coming back online re-seeds silently.
  useEffect(() => {
    if (!isOnline) {
      seeded.current = false;
      stopAlert();
    }
  }, [isOnline]);

  const triggerTest = () => {
    stopFn.current?.();
    stopFn.current = playOrderAlert();
  };

  return { newCount, triggerTest, stopAlert };
}

// ── Login / Register ──────────────────────────────────────────────────────────

function LoginForm() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [view, setView] = useState<AuthView>("login");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    password: "",
    city: "Lahore",
    vehicleType: "bike",
    confirmPassword: "",
  });

  const loginMutation = useLoginRider();
  const registerMutation = useRegisterRider();
  const set = (k: string) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const pending = loginMutation.isPending || registerMutation.isPending;

  const onSuccess = () => qc.invalidateQueries({ queryKey: getGetRiderMeQueryKey() });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (view === "login") {
      loginMutation.mutate(
        { data: { phone: form.phone, password: form.password } },
        {
          onSuccess,
          onError: (err: any) =>
            toast({
              title: "Login failed",
              description: err?.message || "Invalid phone or password",
              variant: "destructive",
            }),
        }
      );
    } else {
      if (form.password !== form.confirmPassword) {
        toast({ title: "Passwords don't match", variant: "destructive" });
        return;
      }
      registerMutation.mutate(
        {
          data: {
            name: form.name,
            phone: form.phone,
            password: form.password,
            city: form.city,
            vehicleType: form.vehicleType,
          },
        },
        {
          onSuccess,
          onError: (err: any) =>
            toast({
              title: "Registration failed",
              description: err?.message || "Could not create account",
              variant: "destructive",
            }),
        }
      );
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-500 to-red-600 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Bike className="w-10 h-10 text-orange-500" />
          </div>
          <h1 className="text-3xl font-bold text-white">Dastak Rider</h1>
          <p className="text-orange-100 mt-1">Delivery Partner App</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6">
          <div className="flex rounded-xl bg-gray-100 p-1 mb-6">
            {(["login", "register"] as AuthView[]).map((v) => (
              <button
                key={v}
                type="button"
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
                  view === v ? "bg-white shadow text-orange-600" : "text-gray-500"
                }`}
                onClick={() => setView(v)}
              >
                {v}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {view === "register" && (
              <>
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Full Name</label>
                  <Input placeholder="Ali Hassan" value={form.name} onChange={set("name")} required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-gray-700 block mb-1">City</label>
                    <select
                      className="w-full h-10 px-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      value={form.city}
                      onChange={set("city")}
                    >
                      {CITIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700 block mb-1">Vehicle</label>
                    <select
                      className="w-full h-10 px-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      value={form.vehicleType}
                      onChange={set("vehicleType")}
                    >
                      <option value="bike">Bike</option>
                      <option value="car">Car</option>
                    </select>
                  </div>
                </div>
              </>
            )}
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Phone Number</label>
              <Input placeholder="0300-1234567" value={form.phone} onChange={set("phone")} required />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Password</label>
              <Input
                type="password"
                placeholder="Enter password"
                value={form.password}
                onChange={set("password")}
                required
              />
            </div>
            {view === "register" && (
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Confirm Password</label>
                <Input
                  type="password"
                  placeholder="Repeat password"
                  value={form.confirmPassword}
                  onChange={set("confirmPassword")}
                  required
                />
              </div>
            )}
            <Button
              type="submit"
              className="w-full py-3 text-base bg-orange-500 hover:bg-orange-600 text-white"
              disabled={pending}
            >
              {pending
                ? view === "login"
                  ? "Logging in..."
                  : "Creating account..."
                : view === "login"
                  ? "Log In"
                  : "Create Account"}
            </Button>
          </form>
        </div>

        <p className="text-center text-orange-200 text-xs mt-6">Dastak Rider App · Powered by Dastak</p>
      </div>
    </div>
  );
}

// ── Order Detail Modal ────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value?: ReactNode }) {
  if (value == null || value === "" || value === false) return null;
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900 text-right">{value}</span>
    </div>
  );
}

function RiderOrderDetailModal({
  order,
  onClose,
}: {
  order: RiderOrder;
  onClose: () => void;
}) {
  const isCod = (order.paymentType || "").toLowerCase().includes("cod") ||
    (order.paymentType || "").toLowerCase().includes("cash");
  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900 truncate">{order.restaurantName || "Order"}</h3>
            {order.orderNum && <p className="text-xs text-gray-400">Order #{order.orderNum}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100 shrink-0">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Status + payment */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={`border-0 text-xs ${STATUS_COLORS[order.status] || "bg-gray-100 text-gray-700"}`}>
              {STATUS_LABELS[order.status] || order.status}
            </Badge>
            {order.paymentType && (
              <Badge className={`border-0 text-xs ${isCod ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                {isCod ? <Banknote className="w-3 h-3 mr-1 inline" /> : <CreditCard className="w-3 h-3 mr-1 inline" />}
                {order.paymentType}
              </Badge>
            )}
          </div>

          {/* Customer */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Customer</h4>
            {order.userName && (
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <User className="w-4 h-4 text-orange-500 shrink-0" /> {order.userName}
              </div>
            )}
            {order.address && (
              <div className="flex items-start gap-2 text-sm text-gray-700">
                <MapPin className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" /> {order.address}
              </div>
            )}
            {order.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-orange-500 shrink-0" />
                <a href={`tel:${order.phone}`} className="text-blue-600 font-medium">{order.phone}</a>
              </div>
            )}
          </div>

          {/* Restaurant */}
          {(order.martAddress || order.martPhone) && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Restaurant</h4>
              {order.martAddress && (
                <div className="flex items-start gap-2 text-sm text-gray-700">
                  <Store className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" /> {order.martAddress}
                </div>
              )}
              {order.martPhone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="w-4 h-4 text-orange-500 shrink-0" />
                  <a href={`tel:${order.martPhone}`} className="text-blue-600 font-medium">{order.martPhone}</a>
                </div>
              )}
            </div>
          )}

          {/* Items with deal parsing */}
          {order.items && order.items.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Items ({order.items.length})
              </h4>
              {order.items.map((item, i) => {
                const { baseName, selections } = parseItemName(item.name);
                return (
                  <div key={i} className="bg-gray-50 rounded-lg p-3">
                    <div className="flex justify-between text-sm font-medium text-gray-900">
                      <span>
                        {item.quantity}× {baseName}
                        {item.size ? ` (${item.size})` : ""}
                      </span>
                      <span>{formatMoney(item.price * item.quantity)}</span>
                    </div>
                    {selections.length > 0 && (
                      <ol className="mt-1.5 ml-1 space-y-0.5 text-xs text-gray-500 list-decimal list-inside">
                        {selections.map((s, j) => (
                          <li key={j}>{s}</li>
                        ))}
                      </ol>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Bill summary */}
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5">
              <Receipt className="w-3.5 h-3.5" /> Bill
            </h4>
            <DetailRow label="Order Total" value={formatMoney(order.total)} />
            <DetailRow label="Your Earning" value={<span className="text-green-600">{formatMoney(order.riderFare || order.deliveryFee)}</span>} />
            {(order.tip ?? 0) > 0 && <DetailRow label="Tip" value={formatMoney(order.tip ?? 0)} />}
            {(order.discount ?? 0) > 0 && (
              <DetailRow label="Discount" value={`- ${formatMoney(order.discount ?? 0)}`} />
            )}
            {order.distance && <DetailRow label="Distance" value={`${order.distance} km`} />}
            {order.zone && <DetailRow label="Zone" value={order.zone} />}
            {isCod && (
              <DetailRow
                label="Cash to collect"
                value={<span className="text-amber-700">{formatMoney(order.total)}</span>}
              />
            )}
            {order.paidToRider && <DetailRow label="Settled" value="Paid to you ✓" />}
          </div>

          {order.comment && (
            <div className="text-sm">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Note</h4>
              <p className="text-gray-700 bg-yellow-50 rounded-lg p-3">{order.comment}</p>
            </div>
          )}

          {/* Timeline */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> Timeline
            </h4>
            <DetailRow label="Placed" value={formatDateTime(order.createdAt)} />
            <DetailRow label="Accepted" value={formatDateTime(order.acceptedTime)} />
            <DetailRow label="Picked up" value={formatDateTime(order.pickUpTime)} />
            <DetailRow label="Delivered" value={formatDateTime(order.timeWhenDelivered)} />
          </div>

          {order.actions && order.actions.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Activity Log</h4>
              {order.actions.map((a, i) => (
                <div key={i} className="flex justify-between text-xs text-gray-500">
                  <span>{a.action}{a.name ? ` — ${a.name}` : ""}</span>
                  <span>{a.time}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Push the rider's GPS location for the order in transit, every ~15s, while one
// is picked up. In-memory on the server; the customer's tracking page reads it.
function useLocationTracking(activeOrders: RiderOrder[]) {
  const pushLocation = usePushRiderLocation();
  const inTransit = activeOrders.find((o) => o.status === "Rider Picked Up");
  const orderId = inTransit?.id;
  const pushRef = useRef(pushLocation.mutate);
  pushRef.current = pushLocation.mutate;

  useEffect(() => {
    if (!orderId || typeof navigator === "undefined" || !navigator.geolocation) return;
    const send = (pos: GeolocationPosition) =>
      pushRef.current({
        data: { orderId, lat: pos.coords.latitude, lng: pos.coords.longitude },
      });
    navigator.geolocation.getCurrentPosition(send, () => {}, { enableHighAccuracy: true });
    const id = setInterval(() => {
      navigator.geolocation.getCurrentPosition(send, () => {}, { enableHighAccuracy: true });
    }, 15_000);
    return () => clearInterval(id);
  }, [orderId]);
}

// ── Order Card ────────────────────────────────────────────────────────────────

function OrderCard({
  order,
  onAccept,
  onStatusUpdate,
  onArrived,
  onClick,
  showAccept,
  showStatus,
  busy,
}: {
  order: RiderOrder;
  onAccept?: () => void;
  onStatusUpdate?: (status: string) => void;
  onArrived?: () => void;
  onClick?: () => void;
  showAccept?: boolean;
  showStatus?: boolean;
  busy?: boolean;
}) {
  // Active progression: Accepted → (Arrived at Restaurant) → Picked Up → Delivered.
  // "Arrived" is an additive checkpoint; the canonical order status stays "Rider Accepted".
  let action:
    | { label: string; color: string; kind: "arrived" }
    | { label: string; color: string; kind: "status"; next: string }
    | undefined;
  if (order.status === "Rider Accepted" && !order.riderArrived) {
    action = {
      label: "Arrived at Restaurant",
      color: "bg-orange-500 hover:bg-orange-600",
      kind: "arrived",
    };
  } else if (order.status === "Rider Accepted" && order.riderArrived) {
    action = {
      label: "Picked Up — On My Way",
      color: "bg-blue-600 hover:bg-blue-700",
      kind: "status",
      next: "Rider Picked Up",
    };
  } else if (order.status === "Rider Picked Up") {
    action = {
      label: "Mark as Delivered ✓",
      color: "bg-green-600 hover:bg-green-700",
      kind: "status",
      next: "Delivered",
    };
  }

  // When arrived but not yet picked up, reflect the "At Restaurant" checkpoint in the badge.
  const atRestaurant = order.status === "Rider Accepted" && !!order.riderArrived;
  const badgeLabel = atRestaurant
    ? "At Restaurant"
    : STATUS_LABELS[order.status] || order.status;
  const badgeColor = atRestaurant
    ? "bg-orange-100 text-orange-800"
    : STATUS_COLORS[order.status] || "bg-gray-100 text-gray-700";

  return (
    <Card className="overflow-hidden border-0 shadow-md bg-white">
      <CardContent className="p-0">
        <div
          className={`p-4 ${onClick ? "cursor-pointer active:bg-gray-50" : ""}`}
          onClick={onClick}
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-gray-900 truncate">{order.restaurantName || "Restaurant"}</h3>
              <p className="text-xs text-gray-400 mt-0.5">{timeAgo(order.createdAt)}</p>
            </div>
            <Badge className={`ml-2 shrink-0 text-xs border-0 ${badgeColor}`}>
              {badgeLabel}
            </Badge>
          </div>

          <div className="space-y-1.5 mb-3">
            {order.address && (
              <div className="flex items-start gap-2 text-sm text-gray-600">
                <MapPin className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                <span className="line-clamp-2">{order.address}</span>
              </div>
            )}
            {order.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-orange-500 shrink-0" />
                <a href={`tel:${order.phone}`} className="text-blue-600 font-medium">
                  {order.phone}
                </a>
              </div>
            )}
            {order.userName && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <User className="w-4 h-4 text-orange-500 shrink-0" />
                <span>{order.userName}</span>
              </div>
            )}
          </div>

          {order.items && order.items.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-3 mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                {order.items.length} item{order.items.length !== 1 ? "s" : ""}
              </p>
              <div className="space-y-1">
                {order.items.slice(0, 3).map((item, i) => {
                  const { baseName, selections } = parseItemName(item.name);
                  return (
                    <div key={i}>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-700">
                          {item.quantity}× {baseName}
                          {item.size ? ` (${item.size})` : ""}
                        </span>
                        <span className="text-gray-500 font-medium">
                          {formatMoney(item.price * item.quantity)}
                        </span>
                      </div>
                      {selections.length > 0 && (
                        <p className="text-xs text-gray-400 truncate ml-1">
                          {selections.join(", ")}
                        </p>
                      )}
                    </div>
                  );
                })}
                {order.items.length > 3 && (
                  <p className="text-xs text-gray-400">+{order.items.length - 3} more items</p>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <div>
              <p className="text-xs text-gray-400">Order Total</p>
              <p className="font-bold text-gray-900 text-lg">{formatMoney(order.total)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">Your Earning</p>
              <p className="font-bold text-green-600 text-lg">
                {formatMoney(order.riderFare || order.deliveryFee || 50)}
              </p>
            </div>
          </div>
        </div>

        {showAccept && onAccept && (
          <div className="px-4 pb-4">
            <Button
              onClick={onAccept}
              disabled={busy}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold"
            >
              <CheckCircle className="w-4 h-4 mr-2" /> Accept Order
            </Button>
          </div>
        )}

        {showStatus && action && (
          <div className="px-4 pb-4">
            <Button
              onClick={() =>
                action.kind === "arrived" ? onArrived?.() : onStatusUpdate?.(action.next)
              }
              disabled={busy}
              className={`w-full text-white font-semibold ${action.color}`}
            >
              <Navigation className="w-4 h-4 mr-2" /> {action.label}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Available Orders Tab ──────────────────────────────────────────────────────

function AvailableOrders({ rider }: { rider: Rider }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<RiderOrder | null>(null);

  const {
    data: orders = [],
    isLoading,
    refetch,
  } = useGetAvailableOrders({
    query: {
      queryKey: getGetAvailableOrdersQueryKey(),
      refetchInterval: 10_000,
      enabled: rider.isOnline,
    },
  });

  const { newCount, triggerTest, stopAlert } = useOrderAlert(orders, rider.isOnline);

  // Ask for notification permission once, when the rider goes online.
  useEffect(() => {
    if (rider.isOnline && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, [rider.isOnline]);

  const acceptMutation = useAcceptOrder();

  const handleAccept = (orderId: string) => {
    acceptMutation.mutate(
      { orderId },
      {
        onSuccess: () => {
          toast({ title: "Order accepted!", description: "Head to the restaurant now." });
          qc.invalidateQueries({ queryKey: getGetAvailableOrdersQueryKey() });
          qc.invalidateQueries({ queryKey: getGetActiveOrdersQueryKey() });
        },
        onError: (e: any) =>
          toast({
            title: "Could not accept",
            description: e?.message || "Order may already be taken",
            variant: "destructive",
          }),
      }
    );
  };

  if (!rider.isOnline) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center px-8">
        <CircleDot className="w-16 h-16 text-gray-300 mb-4" />
        <h3 className="text-lg font-semibold text-gray-600">You're offline</h3>
        <p className="text-gray-400 text-sm mt-1">Go to Profile tab to go Online.</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* New-order alert banner */}
      {newCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl bg-orange-500 text-white px-4 py-3 shadow-lg animate-pulse">
          <Bell className="w-5 h-5 shrink-0" />
          <p className="flex-1 text-sm font-semibold">
            {newCount} new order{newCount > 1 ? "s" : ""} just arrived!
          </p>
          <button
            onClick={stopAlert}
            className="p-1 rounded-full hover:bg-white/20"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Available Orders</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={triggerTest}
            className="text-orange-600 hover:text-orange-700"
            title="Test alert sound"
          >
            <Volume2 className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-orange-600 hover:text-orange-700">
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-center">
          <Package className="w-14 h-14 text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No orders available right now</p>
          <p className="text-gray-400 text-sm">Orders appear here automatically every 10 seconds.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-500">
            {orders.length} order{orders.length !== 1 ? "s" : ""} waiting
          </p>
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              showAccept
              busy={acceptMutation.isPending}
              onAccept={() => handleAccept(order.id)}
              onClick={() => setSelected(order)}
            />
          ))}
        </>
      )}

      {selected && (
        <RiderOrderDetailModal order={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// ── Active Delivery Tab ───────────────────────────────────────────────────────

function ActiveDelivery() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<RiderOrder | null>(null);

  const {
    data: orders = [],
    isLoading,
    refetch,
  } = useGetActiveOrders({
    query: { queryKey: getGetActiveOrdersQueryKey(), refetchInterval: 8_000 },
  });

  const statusMutation = useUpdateOrderStatus();
  const arrivedMutation = useMarkOrderArrived();

  const handleArrived = (orderId: string) => {
    arrivedMutation.mutate(
      { orderId },
      {
        onSuccess: () => {
          toast({ title: "At restaurant", description: "Pick up the order, then tap when on your way." });
          qc.invalidateQueries({ queryKey: getGetActiveOrdersQueryKey() });
        },
        onError: (e: any) =>
          toast({ title: "Error", description: e?.message || "Could not update", variant: "destructive" }),
      }
    );
  };

  const handleStatus = (orderId: string, status: string) => {
    statusMutation.mutate(
      { orderId, data: { status } },
      {
        onSuccess: () => {
          const msg =
            status === "Delivered"
              ? "Delivery complete! Great job! 🎉"
              : status === "Rider Picked Up"
                ? "On your way — deliver safely!"
                : "Status updated.";
          toast({ title: "Updated", description: msg });
          qc.invalidateQueries({ queryKey: getGetActiveOrdersQueryKey() });
          qc.invalidateQueries({ queryKey: getGetOrderHistoryQueryKey() });
          qc.invalidateQueries({ queryKey: getGetRiderMeQueryKey() });
          qc.invalidateQueries({ queryKey: getGetRiderEarningsQueryKey() });
        },
        onError: (e: any) =>
          toast({ title: "Error", description: e?.message || "Could not update", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">My Deliveries</h2>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-orange-600 hover:text-orange-700">
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="h-48 bg-gray-100 rounded-xl animate-pulse" />
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-center">
          <Bike className="w-14 h-14 text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No active deliveries</p>
          <p className="text-gray-400 text-sm">Accept an order from the Orders tab.</p>
        </div>
      ) : (
        orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            showStatus
            busy={statusMutation.isPending || arrivedMutation.isPending}
            onStatusUpdate={(status) => handleStatus(order.id, status)}
            onArrived={() => handleArrived(order.id)}
            onClick={() => setSelected(order)}
          />
        ))
      )}

      {selected && (
        <RiderOrderDetailModal order={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// ── History / Earnings Tab ────────────────────────────────────────────────────

const HISTORY_PERIODS: Array<{ key: "today" | "week" | "month" | "all"; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
  { key: "all", label: "All Time" },
];

function DeliveryHistory() {
  const [period, setPeriod] = useState<"today" | "week" | "month" | "all">("today");
  const [selected, setSelected] = useState<RiderOrder | null>(null);

  const { data: earnings } = useGetRiderEarnings();
  const { data: history = [], isLoading } = useGetOrderHistory(
    { period },
    { query: { queryKey: getGetOrderHistoryQueryKey({ period }) } },
  );

  const periodLabel =
    period === "today" ? "Today"
      : period === "week" ? "This Week"
        : period === "month" ? "This Month"
          : "All";

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">Earnings & History</h2>

      {/* Period filter */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {HISTORY_PERIODS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setPeriod(key)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              period === key ? "bg-white text-orange-600 shadow-sm" : "text-gray-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Today / Week / Month summary columns */}
      {earnings && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-xs text-orange-500 font-medium mb-1">Today</p>
            <p className="text-xl font-bold text-orange-600">{formatMoney(earnings.todayEarnings)}</p>
            <p className="text-xs text-gray-400 mt-0.5">{earnings.todayDeliveries} orders</p>
          </div>
          <div>
            <p className="text-xs text-blue-500 font-medium mb-1">This Week</p>
            <p className="text-xl font-bold text-blue-600">{formatMoney(earnings.weekEarnings)}</p>
            <p className="text-xs text-gray-400 mt-0.5">{earnings.weekDeliveries} orders</p>
          </div>
          <div>
            <p className="text-xs text-purple-500 font-medium mb-1">This Month</p>
            <p className="text-xl font-bold text-purple-600">{formatMoney(earnings.monthEarnings ?? 0)}</p>
            <p className="text-xs text-gray-400 mt-0.5">{earnings.monthDeliveries ?? 0} orders</p>
          </div>
        </div>
      )}

      {/* Total earnings (all time) */}
      {earnings && (
        <Card className="border-0 shadow-md overflow-hidden">
          <div className="bg-gradient-to-br from-green-500 to-green-600 p-5 text-white flex justify-between items-center">
            <div>
              <p className="text-xs opacity-90 mb-1">Total Earnings (All Time)</p>
              <p className="text-3xl font-bold">{formatMoney(earnings.totalEarnings)}</p>
              <p className="text-xs opacity-80 mt-1">{earnings.totalDeliveries} total deliveries</p>
            </div>
            <Wallet className="w-12 h-12 opacity-30" />
          </div>
        </Card>
      )}

      {earnings && earnings.rating > 0 && (
        <Card className="border-0 shadow-md overflow-hidden">
          <div className="bg-gradient-to-br from-yellow-400 to-orange-400 p-4 text-white flex justify-between items-center">
            <div>
              <p className="text-xs opacity-80 mb-1">Your Rating</p>
              <p className="text-3xl font-bold">{earnings.rating.toFixed(1)} ⭐</p>
              <p className="text-xs opacity-80 mt-1">from {earnings.ratingCount} ratings</p>
            </div>
            <Star className="w-12 h-12 opacity-30 fill-white" />
          </div>
        </Card>
      )}

      <h3 className="font-semibold text-gray-700 mt-2">{periodLabel} Deliveries</h3>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : history.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 text-center">
          <History className="w-12 h-12 text-gray-300 mb-2" />
          <p className="text-gray-500">No deliveries in this period</p>
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((order) => (
            <Card
              key={order.id}
              className="border-0 shadow-sm bg-white cursor-pointer active:bg-gray-50"
              onClick={() => setSelected(order)}
            >
              <CardContent className="p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-gray-900 truncate">
                    {order.restaurantName || "Restaurant"}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{order.address || "—"}</p>
                  <p className="text-xs text-gray-400">
                    {formatDateTime(order.timeWhenDelivered || order.updatedAt || order.createdAt)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-green-600">{formatMoney(order.riderFare || order.deliveryFee || 50)}</p>
                  <p className="text-xs text-gray-400">{formatMoney(order.total)} order</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <RiderOrderDetailModal order={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// ── Profile Tab ───────────────────────────────────────────────────────────────

function RiderProfile({ rider }: { rider: Rider }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const toggleMutation = useUpdateRiderAvailability();
  const logoutMutation = useLogoutRider();

  const handleToggle = (isOnline: boolean) => {
    toggleMutation.mutate(
      { data: { isOnline } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetRiderMeQueryKey() });
          toast({ title: isOnline ? "You're now Online 🟢" : "You're now Offline 🔴" });
        },
      }
    );
  };

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        qc.clear();
        qc.invalidateQueries({ queryKey: getGetRiderMeQueryKey() });
      },
    });
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">My Profile</h2>

      <Card className="border-0 shadow-md overflow-hidden">
        <div className="bg-gradient-to-br from-orange-500 to-red-600 p-6 text-white">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center text-2xl font-bold">
              {(rider.name || "?").charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="text-xl font-bold">{rider.name}</h3>
              <p className="text-orange-100 text-sm">{rider.phone}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs bg-white/20 rounded-full px-2 py-0.5 capitalize">
                  {rider.vehicleType}
                </span>
                <span className="text-xs bg-white/20 rounded-full px-2 py-0.5">{rider.city}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 grid grid-cols-3 divide-x divide-gray-100 text-center bg-white">
          <div className="px-2">
            <p className="text-xl font-bold text-gray-900">{rider.totalDeliveries}</p>
            <p className="text-xs text-gray-500 mt-0.5">Deliveries</p>
          </div>
          <div className="px-2">
            <p className="text-xl font-bold text-gray-900">Rs. {(rider.totalEarnings || 0).toFixed(0)}</p>
            <p className="text-xs text-gray-500 mt-0.5">Earned</p>
          </div>
          <div className="px-2">
            <p className="text-xl font-bold text-gray-900">{rider.rating > 0 ? rider.rating.toFixed(1) : "—"}</p>
            <p className="text-xs text-gray-500 mt-0.5">Rating</p>
          </div>
        </div>
      </Card>

      {/* Online toggle */}
      <Card className="border-0 shadow-md bg-white">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-900">Availability</p>
              <p className="text-sm text-gray-500 mt-0.5">
                {rider.isOnline
                  ? "You are online and visible to customers"
                  : "You are offline — go online to receive orders"}
              </p>
            </div>
            <button
              onClick={() => handleToggle(!rider.isOnline)}
              disabled={toggleMutation.isPending}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus-visible:outline-none ${
                rider.isOnline ? "bg-green-500" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  rider.isOnline ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          <div
            className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
              rider.isOnline ? "bg-green-50 text-green-700" : "bg-gray-50 text-gray-500"
            }`}
          >
            <Power className={`w-4 h-4 ${rider.isOnline ? "text-green-500" : "text-gray-400"}`} />
            {rider.isOnline ? "Online — accepting orders" : "Offline"}
          </div>
        </CardContent>
      </Card>

      {/* Cash collection */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-0 shadow-sm bg-white">
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 mb-1">
              <Banknote className="w-4 h-4 text-amber-500" />
              <p className="text-xs text-gray-500">Active Collection</p>
            </div>
            <p className="text-xl font-bold text-amber-600">{formatMoney(rider.pendingCollection ?? 0)}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Cash in Hand</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-white">
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 mb-1">
              <Wallet className="w-4 h-4 text-rose-500" />
              <p className="text-xs text-gray-500">Pending Collection</p>
            </div>
            <p className="text-xl font-bold text-rose-600">{formatMoney(rider.unpaidCollection ?? 0)}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Unpaid to Company</p>
          </CardContent>
        </Card>
      </div>

      {/* Account info */}
      <Card className="border-0 shadow-sm bg-white">
        <CardContent className="p-4 space-y-3">
          <h4 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Account Details</h4>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Phone</span>
            <span className="font-medium">{rider.phone}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">City</span>
            <span className="font-medium">{rider.city}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Vehicle</span>
            <span className="font-medium capitalize">{rider.vehicleType}</span>
          </div>
          {(rider.tillNoonFare ?? 0) > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Per-Delivery Fare</span>
              <span className="font-medium">{formatMoney(rider.tillNoonFare ?? 0)}</span>
            </div>
          )}
          {rider.riderZones && rider.riderZones.length > 0 && (
            <div className="flex justify-between text-sm gap-3">
              <span className="text-gray-500 shrink-0">Zones</span>
              <span className="font-medium text-right">{rider.riderZones.join(", ")}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Button
        variant="outline"
        className="w-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
        onClick={handleLogout}
        disabled={logoutMutation.isPending}
      >
        <LogOut className="w-4 h-4 mr-2" />
        {logoutMutation.isPending ? "Logging out..." : "Log Out"}
      </Button>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function RiderApp() {
  const [view, setView] = useState<RiderView>("available");

  const { data: rider, isLoading, isError } = useGetRiderMe({
    query: { queryKey: getGetRiderMeQueryKey(), retry: false },
  });

  const { data: activeOrders = [] } = useGetActiveOrders({
    query: { queryKey: getGetActiveOrdersQueryKey(), refetchInterval: 10_000, enabled: !!rider },
  });

  // GPS tracking runs app-wide (not tab-scoped) so it keeps publishing while a
  // picked-up order is in transit, regardless of which tab the rider is on.
  useLocationTracking(activeOrders);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-orange-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-orange-500 rounded-full flex items-center justify-center mx-auto mb-3 animate-pulse">
            <Bike className="w-8 h-8 text-white" />
          </div>
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!rider || isError) {
    return <LoginForm />;
  }

  const tabs: Array<{ key: RiderView; label: string; icon: any; badge?: number }> = [
    { key: "available", label: "Orders", icon: Package },
    { key: "active", label: "Active", icon: Bike, badge: activeOrders.length },
    { key: "history", label: "Earnings", icon: TrendingUp },
    { key: "profile", label: "Profile", icon: User },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto relative">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-100 shadow-sm">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center">
              <Bike className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-900 text-sm leading-none">Dastak Rider</p>
              <p className="text-xs text-gray-500 leading-none mt-0.5">{rider.name}</p>
            </div>
          </div>
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
              rider.isOnline ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
            }`}
          >
            <div
              className={`w-1.5 h-1.5 rounded-full ${
                rider.isOnline ? "bg-green-500 animate-pulse" : "bg-gray-400"
              }`}
            />
            {rider.isOnline ? "Online" : "Offline"}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto pb-20">
        {view === "available" && <AvailableOrders rider={rider} />}
        {view === "active" && <ActiveDelivery />}
        {view === "history" && <DeliveryHistory />}
        {view === "profile" && <RiderProfile rider={rider} />}
      </main>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-100 z-50">
        <div className="flex">
          {tabs.map(({ key, label, icon: Icon, badge }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors relative ${
                view === key ? "text-orange-500" : "text-gray-400"
              }`}
            >
              <div className="relative">
                <Icon className="w-5 h-5" />
                {badge != null && badge > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold">
                    {badge}
                  </span>
                )}
              </div>
              <span>{label}</span>
              {view === key && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-orange-500 rounded-full" />
              )}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
