import {
  MongoClient,
  type ChangeStream,
  type Db,
  type ResumeToken,
} from "mongodb";
import { logger } from "./logger";

let db: Db;
const LIVE_CHANGE_RETRY_MS = 5_000;
const LIVE_CHANGE_RECONCILE_MAX_RETRY_MS = 60_000;

export type LiveChangeCollection = "orders" | "chats";

export interface LiveChange {
  collection: LiveChangeCollection;
  id: string;
}

type LiveChangeListener = (change: LiveChange) => void | Promise<void>;
type LiveChangeResetListener = () => void | Promise<void>;

let liveChangeStream: ChangeStream | null = null;
let liveChangeRetryTimer: ReturnType<typeof setTimeout> | null = null;
let liveChangeReconcileTimer: ReturnType<typeof setTimeout> | null = null;
let liveChangeResumeToken: ResumeToken | undefined;
let liveChangeNeedsReconciliation = false;
let liveChangeReconciliationGeneration = 0;
let liveChangeReconciliationRunning = false;
let liveChangeReconciliationAttempts = 0;
const liveChangeListeners = new Set<LiveChangeListener>();
const liveChangeResetListeners = new Set<LiveChangeResetListener>();

export async function connectMongo(): Promise<void> {
  const uri = process.env["MONGODB_URI_RIDER"];
  if (!uri) throw new Error("MONGODB_URI_RIDER environment variable is required.");
  const client = new MongoClient(uri);
  await client.connect();
  db = client.db();
  logger.info("Connected to MongoDB");
}

// Riders are stored in the shared `users` collection with `type: "rider"`.
export function usersCol() {
  return db.collection("users");
}

export function ordersCol() {
  return db.collection("orders");
}

// Reviews are stored with _id = rider's user ID (string, not ObjectId).
export function reviewsCol() {
  return db.collection("reviews");
}

// Chat messages are stored in the `chats` collection.
// Each document: { _id, orderId, riderId, userId, chat: [{ _id, name, type, txt, time, createdAt, read }] }
export function chatsCol() {
  return db.collection("chats");
}

export function watchLiveChanges(resumeAfter?: ResumeToken) {
  return db.watch([
    {
      $match: {
        "ns.coll": { $in: ["orders", "chats"] },
      },
    },
  ], resumeAfter === undefined ? undefined : { resumeAfter });
}

function cannotResumeChangeStream(error: unknown): boolean {
  const candidate = error as {
    code?: unknown;
    hasErrorLabel?: (label: string) => boolean;
  };
  return (
    candidate.code === 260 ||
    candidate.code === 280 ||
    candidate.code === 286 ||
    candidate.hasErrorLabel?.("NonResumableChangeStreamError") === true
  );
}

function scheduleLiveChangeReconnect(error?: unknown): void {
  if (liveChangeRetryTimer !== null || liveChangeListeners.size === 0) return;

  if (error) {
    logger.warn(
      { err: String(error) },
      "Mongo live change source disconnected",
    );
    if (cannotResumeChangeStream(error)) {
      liveChangeResumeToken = undefined;
      liveChangeNeedsReconciliation = true;
      liveChangeReconciliationGeneration += 1;
      logger.warn(
        "Mongo live change resume token is no longer valid; current state will be reconciled after reconnecting",
      );
    }
  }

  const previousStream = liveChangeStream;
  liveChangeStream = null;
  previousStream?.removeAllListeners();
  previousStream?.close().catch(() => {});

  liveChangeRetryTimer = setTimeout(() => {
    liveChangeRetryTimer = null;
    connectLiveChangeSource();
  }, LIVE_CHANGE_RETRY_MS);
}

async function reconcileLiveChangeState(): Promise<void> {
  if (
    !liveChangeNeedsReconciliation ||
    liveChangeReconciliationRunning ||
    liveChangeResetListeners.size === 0
  ) {
    return;
  }

  liveChangeReconciliationRunning = true;
  const generation = liveChangeReconciliationGeneration;
  try {
    const results = await Promise.allSettled(
      [...liveChangeResetListeners].map((listener) => listener()),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) throw failure.reason;

    if (generation === liveChangeReconciliationGeneration) {
      liveChangeNeedsReconciliation = false;
      liveChangeReconciliationAttempts = 0;
      logger.info("Mongo live change reconciliation completed");
    } else {
      logger.info(
        "Mongo live change source reset again during reconciliation; running another pass",
      );
    }
  } catch (error) {
    liveChangeReconciliationAttempts += 1;
    const retryMs = Math.min(
      LIVE_CHANGE_RETRY_MS * (2 ** (liveChangeReconciliationAttempts - 1)),
      LIVE_CHANGE_RECONCILE_MAX_RETRY_MS,
    );
    logger.error(
      { err: String(error), retryMs },
      "Mongo live change reconciliation failed; retrying",
    );
    if (liveChangeReconcileTimer === null) {
      liveChangeReconcileTimer = setTimeout(() => {
        liveChangeReconcileTimer = null;
        void reconcileLiveChangeState();
      }, retryMs);
    }
  } finally {
    liveChangeReconciliationRunning = false;
    if (
      liveChangeNeedsReconciliation &&
      liveChangeReconcileTimer === null
    ) {
      void reconcileLiveChangeState();
    }
  }
}

function connectLiveChangeSource(): void {
  if (liveChangeStream !== null || liveChangeListeners.size === 0) return;

  try {
    const stream = watchLiveChanges(liveChangeResumeToken);
    liveChangeStream = stream;

    stream.on("change", (change) => {
      liveChangeResumeToken = change._id;
      if (!("ns" in change) || !("documentKey" in change)) return;

      const collection = change.ns.coll;
      const documentId = change.documentKey._id;
      if (
        (collection !== "orders" && collection !== "chats") ||
        documentId === undefined
      ) {
        return;
      }

      const liveChange: LiveChange = {
        collection,
        id: String(documentId),
      };
      for (const listener of liveChangeListeners) {
        Promise.resolve(listener(liveChange)).catch((error) => {
          logger.warn(
            {
              err: String(error),
              collection: liveChange.collection,
              documentId: liveChange.id,
            },
            "Mongo live change listener failed",
          );
        });
      }
    });
    stream.once("error", scheduleLiveChangeReconnect);
    stream.once("close", () => scheduleLiveChangeReconnect());
    logger.info("Mongo live change source connected");

    if (liveChangeNeedsReconciliation) {
      void reconcileLiveChangeState();
    }
  } catch (error) {
    scheduleLiveChangeReconnect(error);
  }
}

/**
 * Subscribe to order/chat changes from the local MongoDB change stream.
 *
 * A single shared stream feeds the rider WebSocket server and background
 * notification watchers. It reconnects while at least one consumer remains
 * subscribed, so consumers do not need their own external feed connections.
 */
export function subscribeToLiveChanges(
  listener: LiveChangeListener,
  onReset?: LiveChangeResetListener,
): () => void {
  liveChangeListeners.add(listener);
  if (onReset) liveChangeResetListeners.add(onReset);
  connectLiveChangeSource();
  if (liveChangeNeedsReconciliation) {
    void reconcileLiveChangeState();
  }

  return () => {
    liveChangeListeners.delete(listener);
    if (onReset) liveChangeResetListeners.delete(onReset);
    if (liveChangeListeners.size > 0) return;

    if (liveChangeRetryTimer !== null) {
      clearTimeout(liveChangeRetryTimer);
      liveChangeRetryTimer = null;
    }
    if (liveChangeReconcileTimer !== null) {
      clearTimeout(liveChangeReconcileTimer);
      liveChangeReconcileTimer = null;
    }
    const stream = liveChangeStream;
    liveChangeStream = null;
    stream?.removeAllListeners();
    stream?.close().catch(() => {});
  };
}

// Rider challenge definitions are additive records owned by the rider app.
// They intentionally live outside the shared users/orders documents.
export function riderChallengesCol() {
  return db.collection("riderChallenges");
}

// Wallet entries currently contain challenge bonuses. Delivery earnings are
// derived live from shared orders so they remain aligned with the existing
// rider-fare calculation.
export function riderWalletEntriesCol() {
  return db.collection("riderWalletEntries");
}
