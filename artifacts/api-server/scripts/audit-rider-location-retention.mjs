import { pathToFileURL } from "node:url";
import { MongoClient } from "mongodb";

export const RETENTION_SECONDS = 300;
export const AUDIT_MAX_TIME_MS = 15_000;

// Scalar aggregation $type deliberately distinguishes dates from arrays.
// No GPS coordinates, rider identities or order identifiers leave MongoDB.
export function retentionAuditPipeline(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("A valid audit time is required");
  }
  const cutoff = new Date(now.getTime() - RETENTION_SECONDS * 1000);
  return [
    {
      $project: {
        _id: 0,
        timestampType: { $type: "$updatedAt" },
        bucket: {
          $cond: [
            { $eq: [{ $type: "$updatedAt" }, "date"] },
            {
              $switch: {
                branches: [
                  { case: { $gt: ["$updatedAt", now] }, then: "future_date" },
                  { case: { $lt: ["$updatedAt", cutoff] }, then: "expired_date" },
                ],
                default: "fresh_date",
              },
            },
            "legacy_or_invalid",
          ],
        },
      },
    },
    {
      $group: {
        _id: { timestampType: "$timestampType", bucket: "$bucket" },
        count: { $sum: 1 },
      },
    },
    { $sort: { "_id.timestampType": 1, "_id.bucket": 1 } },
  ];
}

export async function auditRiderLocationRetention(db, now = new Date()) {
  const collection = db.collection("riderLocations");
  const counts = await collection.aggregate(retentionAuditPipeline(now), {
    maxTimeMS: AUDIT_MAX_TIME_MS,
    allowDiskUse: false,
    readConcern: { level: "majority" },
  }).toArray();
  // A missing collection is an empty audit, not a reason to create it.
  let indexes;
  try {
    indexes = await collection.listIndexes({ maxTimeMS: AUDIT_MAX_TIME_MS }).toArray();
  } catch (error) {
    if (error?.code !== 26) throw error;
    indexes = [];
  }
  return {
    readOnly: true,
    auditedAt: now.toISOString(),
    proposedRetentionSeconds: RETENTION_SECONDS,
    counts,
    indexes: indexes.map((index) => ({
      name: index.name,
      key: index.key,
      expireAfterSeconds: index.expireAfterSeconds ?? null,
      partial: index.partialFilterExpression !== undefined,
      sparse: index.sparse === true,
      unique: index.unique === true,
      hidden: index.hidden === true,
    })),
  };
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("Read-only audit: node scripts/audit-rider-location-retention.mjs --database <confirmed-database-name>");
    return;
  }
  if (args.length !== 2 || args[0] !== "--database" || !args[1].trim()) {
    throw new Error("Pass --database with the independently confirmed shared database name");
  }
  const uri = process.env.MONGODB_URI_RIDER;
  if (!uri) throw new Error("MONGODB_URI_RIDER is required");
  // Do not import connectMongo(): normal API startup performs unrelated writes.
  const client = new MongoClient(uri, {
    appName: "rider-location-retention-read-only-audit",
    maxPoolSize: 1,
    serverSelectionTimeoutMS: 5_000,
    timeoutMS: 30_000,
  });
  try {
    const db = client.db();
    if (db.databaseName !== args[1]) {
      throw new Error("Configured database does not match the confirmed target");
    }
    await client.connect();
    console.log(JSON.stringify(await auditRiderLocationRetention(db), null, 2));
  } finally {
    await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Raw driver errors may contain credentials, hosts, or document contents.
    console.error("Read-only audit failed. Check the confirmed database, access permissions and connectivity. No maintenance was attempted.");
    process.exitCode = 1;
  });
}
