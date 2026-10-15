export const RIDER_ACCEPTANCE_COOLDOWN_MS = 2_000;

export function getRiderAcceptanceCooldownRemainingMs(
  lastAcceptedAt: Date | string | number | null | undefined,
  nowMs: number = Date.now(),
): number {
  if (lastAcceptedAt == null) return 0;

  const lastAcceptedAtMs =
    lastAcceptedAt instanceof Date
      ? lastAcceptedAt.getTime()
      : new Date(lastAcceptedAt).getTime();
  if (!Number.isFinite(lastAcceptedAtMs)) return 0;

  return Math.max(
    0,
    RIDER_ACCEPTANCE_COOLDOWN_MS - (nowMs - lastAcceptedAtMs),
  );
}
