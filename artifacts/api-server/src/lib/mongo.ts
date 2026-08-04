import { MongoClient, type Db } from "mongodb";
import { logger } from "./logger";

let db: Db;

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
