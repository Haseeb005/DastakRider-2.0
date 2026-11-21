export const MAX_GPS_FIX_AGE_MS: number;

export interface ActiveDeliveryOrderIdentity {
  _id?: string | null;
  id?: string | null;
  status?: string | null;
}

export function selectActiveDeliveryOrderIds(
  orders: readonly ActiveDeliveryOrderIdentity[],
): string[];

export function capturedAtForFreshFix(
  timestamp: number,
  now?: number,
): string | null;
