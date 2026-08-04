/**
 * Module-level store that coordinates chat badge state across screens.
 *
 * - chatBadgeStore tracks which order the rider currently has open in the
 *   chat screen, and when each order's badge was last cleared.
 * - Components subscribe to be notified when these values change so they can
 *   re-render without a React context tree.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** orderId of the chat screen currently mounted in the navigation stack. */
let _openChatOrderId: string | null = null;

/**
 * Per-order timestamp (ms) of the last time the rider opened that order's chat.
 * Messages older than this timestamp are treated as "seen" even if the server
 * still has them flagged as unread.
 */
const _clearedAt: Record<string, number> = {};

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => fn());
}

/** Called by the chat screen on mount. */
export function openChat(orderId: string) {
  _openChatOrderId = orderId;
  _clearedAt[orderId] = Date.now();
  notify();
}

/** Called by the chat screen on unmount. */
export function closeChat() {
  _openChatOrderId = null;
  notify();
}

export function getOpenChatOrderId(): string | null {
  return _openChatOrderId;
}

/**
 * Returns the timestamp when the rider last opened chat for the given order.
 * 0 means they have never opened it.
 */
export function getClearedAt(orderId: string): number {
  return _clearedAt[orderId] ?? 0;
}
