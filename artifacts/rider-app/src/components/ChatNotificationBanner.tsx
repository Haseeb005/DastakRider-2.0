/**
 * ChatNotificationBanner
 *
 * A slide-in banner that appears at the top of the screen when a customer
 * sends a new message and the chat panel is not already open.
 * Auto-dismisses after 5 s; the rider can also tap "Reply" to open the
 * chat panel or press × to dismiss manually.
 */
import { MessageCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface BannerInfo {
  orderId: string;
  customerName?: string;
  orderNum?: string | number;
}

interface Props {
  banner: BannerInfo | null;
  /** Called when the rider taps "Reply". */
  onOpenChat: (orderId: string) => void;
  /** Called once the banner has finished dismissing. */
  onDismiss: () => void;
}

export function ChatNotificationBanner({ banner, onOpenChat, onDismiss }: Props) {
  // `shown` drives the CSS transition — set true slightly after mount so the
  // initial paint renders the "hidden" state first and the transition fires.
  const [shown, setShown] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const slideOutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Slide in when banner arrives, slide out after 5 s.
  useEffect(() => {
    if (!banner) return;

    clearTimeout(timerRef.current);
    clearTimeout(slideOutRef.current);
    setShown(false);

    // Next tick: animate in.
    const inTimer = setTimeout(() => setShown(true), 20);

    // Auto-dismiss after 5 s.
    timerRef.current = setTimeout(() => slideOut(), 5_000);

    return () => {
      clearTimeout(inTimer);
      clearTimeout(timerRef.current);
      clearTimeout(slideOutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banner?.orderId]);

  function slideOut() {
    clearTimeout(timerRef.current);
    setShown(false);
    // Wait for transition to finish before removing from DOM.
    slideOutRef.current = setTimeout(onDismiss, 350);
  }

  if (!banner) return null;

  return (
    <div
      className={[
        "fixed top-4 left-1/2 z-[9999] w-[min(360px,calc(100vw-32px))] -translate-x-1/2",
        "transition-all duration-300 ease-out",
        shown ? "translate-y-0 opacity-100" : "-translate-y-6 opacity-0 pointer-events-none",
      ].join(" ")}
    >
      <div className="flex items-center gap-3 rounded-2xl bg-[#DB143C] px-4 py-3 shadow-2xl">
        {/* Icon */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
          <MessageCircle className="h-5 w-5 text-white" />
        </div>

        {/* Text */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight text-white">
            {banner.customerName ?? "Customer"}
          </p>
          <p className="mt-0.5 text-xs leading-tight text-white/80">
            Sent you a message
            {banner.orderNum ? ` · #${banner.orderNum}` : ""}
          </p>
        </div>

        {/* Reply */}
        <button
          onClick={() => {
            slideOut();
            onOpenChat(banner.orderId);
          }}
          className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-[#DB143C] transition-colors hover:bg-white/90 active:scale-95"
        >
          Reply
        </button>

        {/* Dismiss */}
        <button
          onClick={slideOut}
          className="shrink-0 text-white/70 transition-colors hover:text-white"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
