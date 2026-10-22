import assert from "node:assert/strict";
import test from "node:test";

import { filterOnlineRiderPushTargets } from "../lib/riderPushTargets";

test("push targets are limited to explicitly online, active rider accounts", () => {
  const targets = filterOnlineRiderPushTargets(
    ["online-player", "offline-player", "deleted-player"],
    ["online-rider", "offline-rider", "deleted-rider"],
    [
      {
        _id: "online-rider",
        playerId: "online-player",
        type: "rider",
        isOnline: true,
      },
      {
        _id: "offline-rider",
        playerId: "offline-player",
        type: "rider",
        isOnline: false,
      },
      {
        _id: "deleted-rider",
        playerId: "deleted-player",
        type: "rider",
        isOnline: true,
        deleted: true,
      },
      {
        _id: "online-customer",
        playerId: "customer-player",
        type: "customer",
        isOnline: true,
      },
    ],
  );

  assert.deepEqual(targets, {
    subscriptionIds: ["online-player"],
    riderIds: ["online-rider"],
  });
});

test("unknown subscription and rider IDs are not treated as online", () => {
  assert.deepEqual(
    filterOnlineRiderPushTargets(
      ["unknown-player"],
      ["unknown-rider"],
      [],
    ),
    { subscriptionIds: [], riderIds: [] },
  );
});
