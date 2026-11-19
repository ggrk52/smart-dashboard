import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createApp } from "./http.js";
import { createMdnsAdvertiser } from "./discovery.js";
import { createMarketService } from "./markets.js";
import { createTassNewsService } from "./news.js";
import { createSetupService } from "./setup.js";
import { MirrorStore, createFileStateStorage, createPostgresStateStorage } from "./state.js";
import { createFileLayoutStorage, createPostgresLayoutStorage } from "./layout.js";
import { createHardwareManager } from "./hardware.js";
import { logger } from "./logger.js";
import { startMetricsLogging, stopMetricsLogging } from "./metrics.js";

const VERSION = "1.0.0";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, "..", "public");
const layoutFile = join(__dirname, "..", "data", "layout.json");
const stateFile = join(__dirname, "..", "data", "state.json");

export async function startServer({
  port = Number(process.env.PORT ?? process.env.MIRROR_PORT ?? 8080),
  host = process.env.MIRROR_HOST ?? "0.0.0.0",
  token = process.env.MIRROR_TOKEN ?? "magic-mirror-local-token",
  store,
  layoutStorage = process.env.DATABASE_URL 
    ? createPostgresLayoutStorage(process.env.DATABASE_URL) 
    : createFileLayoutStorage(layoutFile),
  stateStorage = process.env.DATABASE_URL 
    ? createPostgresStateStorage(process.env.DATABASE_URL) 
    : createFileStateStorage(stateFile),
  marketService = createMarketService(),
  newsService = createTassNewsService(),
  mdnsPublisher = createMdnsAdvertiser,
  setupMode = process.env.MIRROR_SETUP_MODE === "1",
  setupService,
  hardwareManager,
  enablePolling = false,
} = {}) {
  let initialLayout = await layoutStorage.load();
  let initialState = await stateStorage.load();

  if (process.env.DATABASE_URL) {
    if (Object.keys(initialLayout).length === 0) {
      const fallbackLayout = await createFileLayoutStorage(layoutFile).load();
      if (Object.keys(fallbackLayout).length > 0) {
        initialLayout = fallbackLayout;
        await layoutStorage.save(initialLayout);
        logger.info("Migrated local layout to Postgres");
      }
    }
    if (Object.keys(initialState).length === 0) {
      const fallbackState = await createFileStateStorage(stateFile).load();
      if (Object.keys(fallbackState).length > 0) {
        initialState = fallbackState;
        await stateStorage.save(initialState);
        logger.info("Migrated local state to Postgres");
      }
    }
  }

  const mirrorStore = store ?? new MirrorStore(undefined, {
    initialLayout,
    initialState,
    layoutStorage,
    stateStorage,
  });

  const hardware = hardwareManager ?? createHardwareManager(mirrorStore);
  await hardware.init().catch((error) => {
    logger.warn(`HardwareManager initialization failed: ${error.message}`);
  });
  let activeToken = token;
  const getToken = () => activeToken;
  const setToken = (nextToken) => {
    activeToken = nextToken;
  };
  const setup = setupService ?? createSetupService({ enabled: setupMode, getToken, setToken });

  const app = createApp({
    store: mirrorStore,
    publicDir,
    token: getToken,
    version: VERSION,
    marketService,
    newsService,
    setupService: setup,
    hardwareManager: hardware,
  });

  const server = createServer(app.handleRequest);
  server.on("upgrade", app.handleUpgrade);

  await new Promise((resolve) => {
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const actualPort = typeof address === "object" ? address.port : port;

  if (enablePolling) {
    marketService.startPolling?.();
    newsService.startPolling?.();
    startMetricsLogging(hardware);
  }

  await setup.startAccessPoint?.().catch((error) => {
    logger.warn(`Setup access point was not started: ${error.publicMessage ?? error.message}`);
  });
  const mdns = await mdnsPublisher({
    port: actualPort,
    version: VERSION,
    setupMode: setup.enabled,
  });

  return {
    server,
    store: mirrorStore,
    get token() {
      return getToken();
    },
    address,
    mdns,
    close: async () => {
      await setup.stop?.();
      await mdns.stop();
      marketService.stop?.();
      newsService.stop?.();
      stopMetricsLogging();

      return new Promise((resolve, reject) => {
        app.closeSockets();
        // A client that never finishes its HTTP request must not block shutdown forever.
        const forceCloseTimer = setTimeout(() => server.closeAllConnections?.(), 1500);
        forceCloseTimer.unref();
        server.close((error) => {
          clearTimeout(forceCloseTimer);
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
        server.closeIdleConnections?.();
      });
    },
  };
}
