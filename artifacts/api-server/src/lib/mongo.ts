import { MongoClient, type Db } from "mongodb";
import { logger } from "./logger";

let db: Db;

export async function connectMongo(): Promise<void> {
  const uri = process.env["MONGODB_URI"];
  if (!uri) throw new Error("MONGODB_URI environment variable is required.");
  const client = new MongoClient(uri);
  await client.connect();
  db = client.db();
  logger.info("Connected to MongoDB");
}

export function ridersCol() {
  return db.collection("riders");
}

export function ordersCol() {
  return db.collection("orders");
}
