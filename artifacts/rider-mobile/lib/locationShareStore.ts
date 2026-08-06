/**
 * Tiny pub/sub store that lets _layout.tsx (always mounted) publish live
 * GPS tracking state so active.tsx can read it for the status banner.
 */

export type LocationShareStatus = "idle" | "sharing" | "error";

let status: LocationShareStatus = "idle";
let trackCount = 0;
const listeners = new Set<() => void>();

export function setLocationShare(
  newStatus: LocationShareStatus,
  newTrackCount: number,
) {
  if (status === newStatus && trackCount === newTrackCount) return;
  status = newStatus;
  trackCount = newTrackCount;
  listeners.forEach((l) => l());
}

export function getLocationStatus(): LocationShareStatus {
  return status;
}

export function getTrackCount(): number {
  return trackCount;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
