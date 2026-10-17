import { randomUUID } from "node:crypto";

import type { RiderCandidate } from "./riderOrderDistribution";

const CLAIM_LEASE_MS = 5 * 60_000;
const CLAIM_RETENTION_MS = 90 * 24 * 60 * 60_000;

export interface RiderOrderPushClaim {
  key: string;
  token: string;
  riderId: string;
  playerId?: string;
}

export interface RiderOrderPushClaimStore {
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: Record<string, unknown>,
  ): Promise<unknown>;
  insertOne(document: Record<string, unknown>): Promise<unknown>;
  updateMany(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): Promise<unknown>;
  deleteMany(filter: Record<string, unknown>): Promise<unknown>;
}

function returnedDocument(result: unknown): unknown {
  if (!result || typeof result !== "object") return null;
  if ("value" in result) return (result as { value?: unknown }).value ?? null;
  return result;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

/**
 * Claim one notification per rider and order-offer generation across all API
 * instances. Pending claims expire so a crashed process cannot block retries
 * forever; accepted claims remain until the TTL cleanup removes old records.
 */
export async function claimRiderOrderPushes(
  store: RiderOrderPushClaimStore,
  orderId: string,
  offerStartedAt: Date,
  riders: RiderCandidate[],
  now = new Date(),
): Promise<RiderOrderPushClaim[]> {
  const claims: RiderOrderPushClaim[] = [];

  for (const rider of riders) {
    const riderId = String(rider._id ?? "");
    if (!riderId) continue;

    const key = `${orderId}:${offerStartedAt.getTime()}:${riderId}`;
    const token = randomUUID();
    const playerId =
      typeof rider.playerId === "string" && rider.playerId.trim()
        ? rider.playerId.trim()
        : undefined;
    const leaseExpiresAt = new Date(now.getTime() + CLAIM_LEASE_MS);
    const expiresAt = new Date(now.getTime() + CLAIM_RETENTION_MS);
    const claimDocument = {
      _id: key,
      orderId,
      offerStartedAt,
      riderId,
      state: "pending",
      token,
      leaseExpiresAt,
      expiresAt,
    };

    const reclaimed = await store.findOneAndUpdate(
      {
        _id: key,
        state: "pending",
        leaseExpiresAt: { $lte: now },
      },
      {
        $set: {
          token,
          leaseExpiresAt,
          expiresAt,
        },
      },
      { returnDocument: "after" },
    );
    if (returnedDocument(reclaimed)) {
      claims.push({ key, token, riderId, playerId });
      continue;
    }

    try {
      await store.insertOne(claimDocument);
      claims.push({ key, token, riderId, playerId });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
  }

  return claims;
}

/** Keep successfully submitted claims; release failed submissions for retry. */
export async function finishRiderOrderPushClaims(
  store: RiderOrderPushClaimStore,
  claims: RiderOrderPushClaim[],
  acceptedByOneSignal: boolean,
  sentAt = new Date(),
): Promise<void> {
  if (claims.length === 0) return;

  const ownership = claims.map(({ key, token }) => ({
    _id: key,
    token,
    state: "pending",
  }));
  const filter = { $or: ownership };

  if (acceptedByOneSignal) {
    await store.updateMany(
      filter,
      {
        $set: { state: "sent", sentAt },
        $unset: { leaseExpiresAt: "" },
      },
    );
  } else {
    await store.deleteMany(filter);
  }
}
