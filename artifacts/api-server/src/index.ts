import { createServer } from "node:http";

import app from "./app";
import { startChatPushWatcher } from "./lib/chatPushWatcher";
import { startOrderPushWatcher } from "./lib/orderPushWatcher";
import { startHeatmapScheduler } from "./lib/heatmapService";
import { startLiveUpdateServer } from "./lib/liveUpdates";
import { logger } from "./lib/logger";
import { connectMongo } from "./lib/mongo";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  await connectMongo();

  // Start the background watcher that sends OneSignal push notifications to
  // riders when a customer message arrives while their app is backgrounded.
  startChatPushWatcher();
  startOrderPushWatcher();
  startHeatmapScheduler();

  const server = createServer(app);
  startLiveUpdateServer(server);

  server.on("error", (err) => {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  });
  server.listen(port, () => {
    logger.info({ port }, "Server listening");
  });
}

start().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
