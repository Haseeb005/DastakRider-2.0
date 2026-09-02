/**
 * Integration coverage for the rider pre-acceptance privacy boundary.
 *
 * The available endpoint must return only restaurant pickup information. Once
 * the rider accepts, the response may contain the full assigned order needed
 * to complete delivery.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { MongoClient, ObjectId } from "mongodb";

import app from "../app.js";
import { connectMongo } from "../lib/mongo.js";

const MONGODB_URI = process.env["MONGODB_URI_RIDER"];
if (!MONGODB_URI) throw new Error("MONGODB_URI_RIDER is required for tests");

const riderId = new ObjectId();
const orderId = new ObjectId();

let mongoClient: MongoClient;
let server: ReturnType<typeof app.listen>;
let serverUrl: string;
let bearerToken: string;

before(async () => {
  await connectMongo();
  mongoClient = new MongoClient(MONGODB_URI);
  await mongoClient.connect();
  const db = mongoClient.db();

  await db.collection("users").insertOne({
    _id: riderId,
    type: "rider",
    name: "Available Privacy Test Rider",
    phone: `available_privacy_${riderId.toHexString()}`,
    password: "available-privacy-password",
    city: "AvailablePrivacyCity",
    vehicleType: "bike",
    isOnline: true,
    status: "idle",
    deleted: false,
    verified: true,
    riderZones: [],
    pendingCollection: 0,
    unpaidCollection: 0,
    tillNoonFare: 275,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.collection("orders").insertOne({
    _id: orderId,
    status: "Admin Accepted",
    city: "AvailablePrivacyCity",
    zone: "AvailablePrivacyZone",
    selfDelivery: false,
    orderType: "Delivery",
    martName: "Privacy Test Restaurant",
    martAddress: "12 Restaurant Pickup Road",
    martPhone: "03001234567",
    martLatitude: 24.8607,
    martLongitude: 67.0011,
    name: "Private Customer Name",
    address: "Private Customer Destination",
    latitude: 24.9001,
    longitude: 67.1002,
    products: [
      {
        productName: "Private Customer Item",
        count: 2,
        price: 900,
        actualPrice: 800,
        net: 1800,
      },
    ],
    paymentType: "COD",
    orderTotal: 1800,
    deliveryCharges: 100,
    riderFare: 275,
    comment: "Private delivery note",
    orderNum: "PRIVATE-ORDER-61",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  serverUrl = `http://localhost:${(server.address() as AddressInfo).port}`;

  const loginResponse = await fetch(`${serverUrl}/api/rider/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone: `available_privacy_${riderId.toHexString()}`,
      password: "available-privacy-password",
    }),
  });
  assert.equal(loginResponse.status, 200);
  const loginBody = (await loginResponse.json()) as { token?: string };
  assert.ok(loginBody.token);
  bearerToken = loginBody.token;
});

after(async () => {
  const db = mongoClient.db();
  await db.collection("orders").deleteOne({ _id: orderId });
  await db.collection("users").deleteOne({ _id: riderId });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await mongoClient.close();
});

describe("rider order privacy boundary", () => {
  it("returns only approved restaurant pickup fields before acceptance", async () => {
    const response = await fetch(`${serverUrl}/api/rider/orders/available`, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    assert.equal(response.status, 200);

    const body = (await response.json()) as Array<Record<string, unknown>>;
    const available = body.find((order) => order.id === orderId.toHexString());
    assert.ok(available);
    assert.deepEqual(Object.keys(available).sort(), [
      "id",
      "martAddress",
      "martLatitude",
      "martLongitude",
      "martPhone",
      "restaurantName",
    ]);
    assert.deepEqual(available, {
      id: orderId.toHexString(),
      restaurantName: "Privacy Test Restaurant",
      martAddress: "12 Restaurant Pickup Road",
      martPhone: "03001234567",
      martLatitude: 24.8607,
      martLongitude: 67.0011,
    });

    const serialized = JSON.stringify(available);
    for (const privateValue of [
      "Private Customer Name",
      "Private Customer Destination",
      "Private Customer Item",
      "COD",
      "1800",
      "275",
      "Private delivery note",
      "PRIVATE-ORDER-61",
    ]) {
      assert.equal(
        serialized.includes(privateValue),
        false,
        `available order leaked ${privateValue}`,
      );
    }
  });

  it("returns the full assigned order after acceptance", async () => {
    const response = await fetch(
      `${serverUrl}/api/rider/orders/${orderId.toHexString()}/accept`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${bearerToken}` },
      },
    );
    assert.equal(response.status, 200);

    const assigned = (await response.json()) as Record<string, any>;
    assert.equal(assigned.id, orderId.toHexString());
    assert.equal(assigned.status, "Rider Accepted");
    assert.equal(assigned.userName, "Private Customer Name");
    assert.equal(assigned.address, "Private Customer Destination");
    assert.equal(assigned.paymentType, "COD");
    assert.equal(assigned.total, 1800);
    assert.equal(assigned.riderFare, 275);
    assert.equal(assigned.comment, "Private delivery note");
    assert.equal(assigned.orderNum, "PRIVATE-ORDER-61");
    assert.deepEqual(assigned.items, [
      {
        name: "Private Customer Item",
        quantity: 2,
        price: 900,
        actualPrice: 800,
        size: null,
        description: null,
        type: null,
        dealItems: [],
      },
    ]);
  });
});