import { networkInterfaces } from "node:os";

import { startServer } from "./server.js";
import { logger } from "./logger.js";

const runtime = await startServer({ enablePolling: true });

const host = typeof runtime.address === "object" ? runtime.address.address : "127.0.0.1";
const port = typeof runtime.address === "object" ? runtime.address.port : process.env.MIRROR_PORT;
const lanUrls = Object.values(networkInterfaces())
  .flat()
  .filter((address) => address && address.family === "IPv4" && !address.internal)
  .map((address) => `http://${address.address}:${port}/`);

logger.info(`🏠 Magic Mirror [LAN] server is running at http://${host}:${port}`);
logger.info(`Mirror UI on this device: http://127.0.0.1:${port}/`);

if ((host === "0.0.0.0" || host === "::") && lanUrls.length > 0) {
  for (const url of lanUrls) {
    logger.info(`LAN server address: ${url}`);
  }
} else {
  logger.info(`Mirror UI: http://${host}:${port}/`);
}

if (runtime.token === "magic-mirror-local-token") {
  logger.warn("⚠  WARNING: Using the default MIRROR_TOKEN. Set a custom token before exposing the server to the network.");
} else {
  logger.info("Bearer token configured (MIRROR_TOKEN).");
}

// Graceful shutdown — important for systemd on Orange Pi
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`\n${signal} received. Shutting down gracefully...`);

  try {
    if (runtime.close) {
      await runtime.close();
    }
  } catch (error) {
    logger.error({ err: error }, "Error during shutdown:");
  }

  logger.info("Server stopped.");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
