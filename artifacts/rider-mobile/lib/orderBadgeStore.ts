/**
 * Module-level store that surfaces the new-available-order count to the tab bar.
 *
 * index.tsx writes the count via `setOrderBadgeCount()` whenever `useOrderAlert`
 * reports new orders. The tab bar subscribes so it can re-render the badge
 * without a React context tree.
 */

type Listener = () => void;
const listeners = new Set<Listener>();

let _count = 0;

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => fn());
}

export function setOrderBadgeCount(n: number) {
  if (_count === n) return;
  _count = n;
  notify();
}

export function getOrderBadgeCount(): number {
  return _count;
}

export function clearOrderBadge() {
  setOrderBadgeCount(0);
}
