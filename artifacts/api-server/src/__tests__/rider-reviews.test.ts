import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";

import app from "../app.js";
import { connectMongo } from "../lib/mongo.js";

const MONGODB_URI = process.env["MONGODB_URI_RIDER"];
if (!MONGODB_URI) throw new Error("MONGODB_URI_RIDER is required for tests");

const riderId = new ObjectId();
const otherRiderId = new ObjectId();
const ownReviewIds = [new ObjectId(), new ObjectId(), new ObjectId()];
const otherReviewId = new ObjectId();

let mongoClient: MongoClient;
let server: ReturnType<typeof app.listen>;
let serverUrl: string;
let bearerToken: string;

before(async () => {
  await connectMongo();

  mongoClient = new MongoClient(MONGODB_URI);
  await mongoClient.connect();
  const db = mongoClient.db();
  const password = await bcrypt.hash("reviews-test-password", 12);

  await db.collection("users").insertMany([
    {
      _id: riderId,
      type: "rider",
      name: "Reviews Test Rider",
      phone: `reviews_test_${riderId.toHexString()}`,
      password,
      city: "TestCity",
      vehicleType: "bike",
      deleted: false,
      isOnline: false,
    },
    {
      _id: otherRiderId,
      type: "rider",
      name: "Other Reviews Test Rider",
      phone: `reviews_test_${otherRiderId.toHexString()}`,
      password,
      city: "TestCity",
      vehicleType: "bike",
      deleted: false,
      isOnline: false,
    },
  ]);

  await db.collection("reviews").insertMany([
    {
      _id: ownReviewIds[0],
      riderId: riderId.toHexString(),
      type: "delivery",
      riderRating: 5,
      comment: "  Very professional delivery  ",
      createdAt: new Date("2026-08-20T10:00:00.000Z"),
      customerPhone: "must-not-be-exposed",
      orderId: new ObjectId().toHexString(),
    },
    {
      _id: ownReviewIds[1],
      riderId: riderId.toHexString(),
      type: "delivery",
      riderRating: 4,
      comment: "",
      createdAt: "2026-08-19T10:00:00.000Z",
    },
    {
      _id: ownReviewIds[2],
      riderId: riderId.toHexString(),
      type: "restaurant",
      riderRating: 1,
      comment: "Not a delivery review",
      createdAt: new Date("2026-08-21T10:00:00.000Z"),
    },
    {
      _id: otherReviewId,
      riderId: otherRiderId.toHexString(),
      type: "delivery",
      riderRating: 1,
      comment: "Another rider's private review",
      createdAt: new Date("2026-08-22T10:00:00.000Z"),
    },
  ]);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  serverUrl = `http://localhost:${(server.address() as AddressInfo).port}`;

  const loginResponse = await fetch(`${serverUrl}/api/rider/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone: `reviews_test_${riderId.toHexString()}`,
      password: "reviews-test-password",
    }),
  });
  assert.equal(loginResponse.status, 200);
  const loginBody = (await loginResponse.json()) as { token?: string };
  assert.ok(loginBody.token);
  bearerToken = loginBody.token;
});

after(async () => {
  const db = mongoClient.db();
  await db
    .collection("reviews")
    .deleteMany({ _id: { $in: [...ownReviewIds, otherReviewId] } });
  await db
    .collection("users")
    .deleteMany({ _id: { $in: [riderId, otherRiderId] } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await mongoClient.close();
});

describe("GET /api/rider/reviews", () => {
  it("requires rider authentication", async () => {
    const response = await fetch(`${serverUrl}/api/rider/reviews`);
    assert.equal(response.status, 401);
  });

  it("returns only the signed-in rider's delivery reviews newest first", async () => {
    const response = await fetch(`${serverUrl}/api/rider/reviews`, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    assert.equal(response.status, 200);

    const body = (await response.json()) as {
      reviews: Array<Record<string, unknown>>;
      rating: number;
      ratingCount: number;
    };

    assert.equal(body.rating, 4.5);
    assert.equal(body.ratingCount, 2);
    assert.equal(body.reviews.length, 2);
    assert.deepEqual(
      body.reviews.map((review) => review.id),
      [ownReviewIds[0].toHexString(), ownReviewIds[1].toHexString()],
    );
    assert.equal(body.reviews[0]?.comment, "Very professional delivery");
    assert.equal(body.reviews[1]?.comment, null);
    assert.equal(body.reviews[0]?.createdAt, "2026-08-20T10:00:00.000Z");
    assert.equal(body.reviews[1]?.createdAt, "2026-08-19T10:00:00.000Z");

    for (const review of body.reviews) {
      assert.deepEqual(Object.keys(review).sort(), [
        "comment",
        "createdAt",
        "id",
        "rating",
      ]);
    }
  });
});