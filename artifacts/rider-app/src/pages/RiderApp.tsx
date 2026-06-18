import { useState, useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetRiderMe,
  getGetRiderMeQueryKey,
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

// ── Utilities ─────────────────────────────────────────────────────────────────
// Real Dastak order status flow:
//   Pending → Rider Accepted → Rider Picked Up → Delivered  (or Rejected)

const STATUS_LABELS: Record<string, string> = {
  Pending: "New Order",
  "Admin Accepted": "New Order",
  "Rider Accepted": "Heading to Restaurant",
  "Rider Picked Up": "On the Way",
  Delivered: "Delivered",
  Rejected: "Rejected",
};

const STATUS_COLORS: Record<string, string> = {
  Pending: "bg-yellow-100 text-yellow-800",
  "Admin Accepted": "bg-brand-100 text-brand-800",
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
    timeZone: "Asia/Karachi",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ── New-order alert: Web Audio arpeggio + browser notification ──────────────────
// Plays an ascending E-major arpeggio (E5 → G5 → B5 → E6) for ~15 seconds.
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
  const cycles = Math.ceil(15 / cycleLen);
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

const ALERT_AUTO_HIDE_MS = 12000;

// Tracks seen order IDs; alerts (sound + notification) when genuinely new ones
// appear. The banner auto-hides after a timeout, when the rider accepts
// (stopAlert), or when the new orders leave the available list.
function useOrderAlert(orders: RiderOrder[], isOnline: boolean) {
  const seen = useRef<Set<string>>(new Set());
  const seeded = useRef(false);
  const stopFn = useRef<(() => void) | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const newIdsRef = useRef<string[]>([]);
  const [newIds, setNewIds] = useState<string[]>([]);

  const clearTimer = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  // Set the banner's new-order list, mirroring into a ref and bailing out of the
  // render when the contents are unchanged (avoids churn on the 10s poll).
  const commitNewIds = (next: string[]) => {
    const prev = newIdsRef.current;
    const same =
      next.length === prev.length && next.every((id, i) => id === prev[i]);
    if (same) return;
    newIdsRef.current = next;
    setNewIds(next);
  };

  const stopAlert = () => {
    stopFn.current?.();
    stopFn.current = null;
    clearTimer();
    commitNewIds([]);
  };

  useEffect(() => {
    if (!isOnline) return;
    const ids = orders.map((o) => o.id);
    const presentIds = new Set(ids);
    if (!seeded.current) {
      seen.current = new Set(ids);
      seeded.current = true;
      return;
    }
    const fresh = ids.filter((id) => !seen.current.has(id));
    // Prune previously-new orders that left the list (accepted, expired, …) and
    // merge in the fresh ones.
    const kept = newIdsRef.current.filter((id) => presentIds.has(id));
    const merged = Array.from(new Set([...kept, ...fresh]));
    commitNewIds(merged);
    // Everything new is gone (accepted/expired) before the timeout — silence the
    // lingering sound immediately so a rider isn't beeped for a vanished order.
    if (merged.length === 0) {
      stopFn.current?.();
      stopFn.current = null;
      clearTimer();
    }
    if (fresh.length > 0) {
      fresh.forEach((id) => seen.current.add(id));
      stopFn.current?.();
      stopFn.current = playOrderAlert();
      clearTimer();
      hideTimer.current = setTimeout(() => {
        stopFn.current?.();
        stopFn.current = null;
        commitNewIds([]);
      }, ALERT_AUTO_HIDE_MS);
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
      if (!presentIds.has(id)) seen.current.delete(id);
    });
  }, [orders, isOnline]);

  // Reset seeding when going offline so coming back online re-seeds silently.
  useEffect(() => {
    if (!isOnline) {
      seeded.current = false;
      stopAlert();
    }
  }, [isOnline]);

  // Clean up sound + timer on unmount.
  useEffect(
    () => () => {
      stopFn.current?.();
      clearTimer();
    },
    [],
  );

  const triggerTest = () => {
    stopFn.current?.();
    stopFn.current = playOrderAlert();
  };

  return { newCount: newIds.length, triggerTest, stopAlert };
}

// ── Login ─────────────────────────────────────────────────────────────────────

function LoginForm() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    phone: "",
    password: "",
  });

  const loginMutation = useLoginRider();
  const set = (k: string) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const pending = loginMutation.isPending;

  const onSuccess = () => qc.invalidateQueries({ queryKey: getGetRiderMeQueryKey() });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-500 to-red-600 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Bike className="w-10 h-10 text-brand-500" />
          </div>
          <h1 className="text-3xl font-bold text-white">Dastak Rider</h1>
          <p className="text-brand-100 mt-1">Delivery Partner App</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Log In</h2>
          <p className="text-sm text-gray-500 mb-6">Sign in to your account</p>

          <form onSubmit={handleSubmit} className="space-y-4">
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
            <Button
              type="submit"
              className="w-full py-3 text-base rounded-full bg-brand-500 hover:bg-brand-600 text-white"
              disabled={pending}
            >
              {pending ? "Logging in..." : "Log In"}
            </Button>
          </form>
        </div>

        <p className="text-center text-brand-200 text-xs mt-6">Dastak Rider App · Powered by Dastak</p>
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
  const isDelivered = order.status === "Delivered";

  const mapsUrl = (query: string) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

  const hasCustomerCoords =
    typeof order.latitude === "number" && typeof order.longitude === "number";
  const customerMapsUrl = mapsUrl(
    hasCustomerCoords
      ? `${order.latitude},${order.longitude}`
      : [order.userName, order.address].filter(Boolean).join(" "),
  );
  const canNavigateCustomer = hasCustomerCoords || !!order.address;

  const hasRestCoords =
    typeof order.martLatitude === "number" &&
    typeof order.martLongitude === "number";
  const restMapsUrl = mapsUrl(
    hasRestCoords
      ? `${order.martLatitude},${order.martLongitude}`
      : [order.restaurantName, order.martAddress].filter(Boolean).join(" "),
  );
  const canNavigateRest =
    hasRestCoords || !!order.martAddress || !!order.restaurantName;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <div className="min-w-0">
            {order.orderNum && <p className="text-xs text-gray-400">Order #{order.orderNum}</p>}
            <h3 className="font-bold text-gray-900 truncate">{order.restaurantName || "Order"}</h3>
            {(order.city || order.zone) && (
              <p className="text-xs text-gray-500 truncate">
                {[order.city, order.zone].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={`border-0 text-xs ${STATUS_COLORS[order.status] || "bg-gray-100 text-gray-700"}`}>
              {STATUS_LABELS[order.status] || order.status}
            </Badge>
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100 shrink-0">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
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

          {/* Customer */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Customer</h4>
            {order.userName && (
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <User className="w-4 h-4 text-brand-500 shrink-0" /> {order.userName}
              </div>
            )}
            {order.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-brand-500 shrink-0" />
                <a href={`tel:${order.phone}`} className="text-blue-600 font-medium">{order.phone}</a>
              </div>
            )}
            {order.address && (
              <div className="flex items-start gap-2 text-sm text-gray-700">
                <MapPin className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" /> {order.address}
              </div>
            )}
            {order.distance && (
              <p className="text-xs text-gray-400 pl-6">{order.distance} km away</p>
            )}
            {canNavigateCustomer && (
              <a
                href={customerMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600"
              >
                <Navigation className="w-3.5 h-3.5" /> Open in Google Maps
              </a>
            )}
          </div>

          {/* Restaurant */}
          {(order.restaurantName || order.martAddress || order.martPhone) && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Restaurant</h4>
              {order.restaurantName && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <Store className="w-4 h-4 text-brand-500 shrink-0" /> {order.restaurantName}
                </div>
              )}
              {order.martAddress && (
                <div className="flex items-start gap-2 text-sm text-gray-700">
                  <MapPin className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" /> {order.martAddress}
                </div>
              )}
              {order.martPhone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="w-4 h-4 text-brand-500 shrink-0" />
                  <a href={`tel:${order.martPhone}`} className="text-blue-600 font-medium">{order.martPhone}</a>
                </div>
              )}
              {canNavigateRest && (
                <a
                  href={restMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600"
                >
                  <Navigation className="w-3.5 h-3.5" /> Open in Google Maps
                </a>
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

          {/* Price Breakdown */}
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5">
              <Receipt className="w-3.5 h-3.5" /> Price Breakdown
            </h4>
            <DetailRow label="Subtotal" value={formatMoney(order.subtotal)} />
            {(order.deliveryFee ?? 0) > 0 && (
              <DetailRow label="Delivery Fee" value={formatMoney(order.deliveryFee)} />
            )}
            {(order.discount ?? 0) > 0 && (
              <DetailRow label="Discount" value={`- ${formatMoney(order.discount ?? 0)}`} />
            )}
            {(order.platformFee ?? 0) > 0 && (
              <DetailRow label="Platform Fee" value={formatMoney(order.platformFee ?? 0)} />
            )}
            {(order.tip ?? 0) > 0 && <DetailRow label="Tip" value={formatMoney(order.tip ?? 0)} />}
            <div className="border-t border-gray-200 pt-2">
              <DetailRow label="Total" value={<span className="font-bold text-gray-900">{formatMoney(order.total)}</span>} />
            </div>
          </div>

          {/* Payment */}
          {order.paymentType && (
            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Payment</h4>
              <div className="flex items-center justify-between gap-2">
                <Badge className={`border-0 text-xs ${isCod ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                  {isCod ? <Banknote className="w-3 h-3 mr-1 inline" /> : <CreditCard className="w-3 h-3 mr-1 inline" />}
                  {order.paymentType}
                </Badge>
                <span className={`text-sm font-medium ${isCod ? "text-amber-700" : "text-emerald-700"}`}>
                  {isCod
                    ? `${formatMoney(order.total)} ${isDelivered ? "collected" : "to collect"}`
                    : "Paid online"}
                </span>
              </div>
            </div>
          )}

          {/* Your Fare */}
          <div className="rounded-lg p-3 bg-green-50 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-green-700/70">Your Fare</p>
              <p className="text-lg font-bold text-green-700">{formatMoney(order.riderFare)}</p>
            </div>
            <Badge className={`border-0 text-xs ${order.paidToRider ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
              {order.paidToRider ? "Paid" : "Pending"}
            </Badge>
          </div>

          {order.comment && (
            <div className="text-sm">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Note</h4>
              <p className="text-gray-700 bg-yellow-50 rounded-lg p-3">{order.comment}</p>
            </div>
          )}

          {order.actions && order.actions.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Activity Log</h4>
              {order.actions.map((a, i) => (
                <div key={i} className="flex justify-between gap-3 text-xs text-gray-500">
                  <span>{a.action}{a.name ? ` — ${a.name}` : ""}</span>
                  <span className="text-right shrink-0">{a.time}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Request live-location permission from the rider. Resolves true only when the
// browser grants access. Used to FORCE location sharing before a delivery can
// start, so the customer can always track the order in transit.
function ensureLocationPermission(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve(true),
      () => resolve(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  });
}

// Continuously push the rider's GPS location for the order in transit while one
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
    // Send one immediately, then stream updates as the rider moves.
    navigator.geolocation.getCurrentPosition(send, () => {}, { enableHighAccuracy: true });
    const watchId = navigator.geolocation.watchPosition(send, () => {}, {
      enableHighAccuracy: true,
      maximumAge: 5_000,
    });
    return () => navigator.geolocation.clearWatch(watchId);
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
      color: "bg-brand-500 hover:bg-brand-600",
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
    ? "bg-brand-100 text-brand-800"
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
              <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                <Clock className="w-3 h-3 shrink-0" />
                {formatDateTime(order.createdAt) || timeAgo(order.createdAt)}
              </p>
            </div>
            <Badge className={`ml-2 shrink-0 text-xs border-0 ${badgeColor}`}>
              {badgeLabel}
            </Badge>
          </div>

          <div className="space-y-1.5 mb-3">
            {order.address && (
              <div className="flex items-start gap-2 text-sm text-gray-600">
                <MapPin className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                <span className="line-clamp-2">{order.address}</span>
              </div>
            )}
            {order.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-brand-500 shrink-0" />
                <a href={`tel:${order.phone}`} className="text-blue-600 font-medium">
                  {order.phone}
                </a>
              </div>
            )}
            {order.userName && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <User className="w-4 h-4 text-brand-500 shrink-0" />
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
                {formatMoney(order.riderFare)}
              </p>
            </div>
          </div>
        </div>

        {showAccept && onAccept && (
          <div className="px-4 pb-4">
            <Button
              onClick={onAccept}
              disabled={busy}
              className="w-full rounded-full bg-brand-500 hover:bg-brand-600 text-white font-semibold"
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
              className={`w-full rounded-full text-white font-semibold ${action.color}`}
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
    // Accepting within the alert window must silence the beep immediately.
    stopAlert();
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
        <div className="flex items-center gap-3 rounded-xl bg-brand-500 text-white px-4 py-3 shadow-lg animate-pulse">
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
        <h2 className="text-lg font-bold text-gray-900">Orders</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={triggerTest}
            className="text-brand-600 hover:text-brand-700"
            title="Test alert sound"
          >
            <Volume2 className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-brand-600 hover:text-brand-700">
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

  const handleStatus = async (orderId: string, status: string) => {
    // Force live-location sharing: a delivery cannot start until the rider grants
    // location access, so the customer can always track the order in transit.
    if (status === "Rider Picked Up") {
      const granted = await ensureLocationPermission();
      if (!granted) {
        toast({
          title: "Location required",
          description:
            "Enable location sharing so the customer can track their delivery, then tap again.",
          variant: "destructive",
        });
        return;
      }
    }
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
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-brand-600 hover:text-brand-700">
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
      </div>

      {orders.some((o) => o.status === "Rider Picked Up") && (
        <div className="flex items-center gap-2.5 rounded-xl bg-green-50 text-green-700 px-4 py-2.5">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
          </span>
          <p className="text-sm font-medium">Sharing your live location with the customer</p>
        </div>
      )}

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
              period === key ? "bg-white text-brand-600 shadow-sm" : "text-gray-500"
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
            <p className="text-xs text-brand-500 font-medium mb-1">Today</p>
            <p className="text-xl font-bold text-brand-600">{formatMoney(earnings.todayEarnings)}</p>
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
          <div className="bg-gradient-to-br from-yellow-400 to-amber-500 p-4 text-white flex justify-between items-center">
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
                  <p className="text-xs text-gray-400 flex items-center gap-1">
                    <Clock className="w-3 h-3 shrink-0" />
                    {formatDateTime(order.createdAt)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-green-600">{formatMoney(order.riderFare)}</p>
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
        <div className="bg-gradient-to-br from-brand-500 to-red-600 p-6 text-white">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center text-2xl font-bold">
              {(rider.name || "?").charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="text-xl font-bold">{rider.name}</h3>
              <p className="text-brand-100 text-sm">{rider.phone}</p>
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
                  ? "Online — receiving orders"
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
      <div className="min-h-screen bg-brand-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-brand-500 rounded-full flex items-center justify-center mx-auto mb-3 animate-pulse">
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
            <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center">
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
                view === key ? "text-brand-500" : "text-gray-400"
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
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-brand-500 rounded-full" />
              )}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
