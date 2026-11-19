import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { extname, join } from "node:path";
import { networkInterfaces } from "node:os";

const standardImages = new Set([
  "basket-apples.jpg",
  "bedroom.jpg",
  "marseille-bay.jpg",
  "normandy-train.jpg",
  "self-portrait.jpg",
  "two-sisters.jpg",
  "water-lilies.jpg",
  "woman-piano.jpg"
]);

import { buildPairingPayload, buildPairingQrSvg } from "./pairing.js";
import { SetupError } from "./setup.js";
import { logger } from "./logger.js";
import { setWsClientCount, incrementApiError, apiLatencyHistogram } from "./metrics.js";
import { tracer } from "./telemetry.js";
import { getUpcomingCalendarEvents } from "./calendar.js";
import { getWeather, getImmichPhotos, streamImmichPhoto, getDishState, getClusterTelemetry, getImmichStats } from "./dashboard_integrations.js";
import { performance } from "node:perf_hooks";
import pinoHttp from "pino-http";

export const httpLogger = pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => req.url === "/api/health" || req.url === "/ws" || req.url?.startsWith("/api/health"),
  },
  customProps: (req, res) => {
    return {
      "http.request.method": req.method,
      "url.path": req.url,
      "network.peer.address": req.remoteAddress,
      "http.response.status_code": res.statusCode,
    };
  },
  serializers: {
    req: () => undefined,
    res: () => undefined,
  },
});

const textEncoder = new TextEncoder();
const JSON_BODY_LIMIT_BYTES = 1024 * 64;
const PHOTO_BODY_LIMIT_BYTES = 1024 * 1024 * 50;
const PHOTO_DATA_LIMIT_BYTES = 1024 * 1024 * 6;
const PHOTO_DURATION_MIN_SECONDS = 1;
const PHOTO_DURATION_MAX_SECONDS = 60 * 60;
const PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".otf": "font/otf",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
const STATIC_CACHE_CONTROL = "public, max-age=300";
const STATIC_CACHE_MAX_BYTES = 1024 * 1024 * 2;
const STATIC_NO_MEMORY_CACHE_EXTENSIONS = new Set([".css", ".js", ".html"]);
const staticFileCache = new Map();

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function binary(response, statusCode, body, mimeType) {
  response.writeHead(statusCode, {
    "Content-Type": mimeType,
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function svg(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function getBearerToken(request) {
  const value = request.headers.authorization ?? "";

  if (!value.startsWith("Bearer ")) {
    return null;
  }

  return value.slice("Bearer ".length).trim();
}

function escapeScriptValue(value) {
  return JSON.stringify(String(value)).slice(1, -1);
}

export function extractIpsFromInterfaces(interfaces) {
  const ips = new Set(["127.0.0.1", "::1"]);
  if (!interfaces) return ips;
  for (const netList of Object.values(interfaces)) {
    if (!Array.isArray(netList)) continue;
    for (const net of netList) {
      if (net?.address) {
        ips.add(net.address.replace(/^::ffff:/, "").toLowerCase());
      }
    }
  }
  return ips;
}

let cachedLocalIps = null;
let lastLocalIpCacheTime = 0;

function getLocalIpAddresses() {
  const now = Date.now();
  if (cachedLocalIps && now - lastLocalIpCacheTime < 30000) {
    return cachedLocalIps;
  }
  try {
    cachedLocalIps = extractIpsFromInterfaces(networkInterfaces());
  } catch {
    cachedLocalIps = new Set(["127.0.0.1", "::1"]);
  }
  lastLocalIpCacheTime = now;
  return cachedLocalIps;
}

export function shouldEmbedUiToken(remoteAddress, customInterfaces = null) {
  if (!remoteAddress) {
    return false;
  }

  const normalized = remoteAddress.replace(/^::ffff:/, "").toLowerCase();
  if (normalized === "127.0.0.1" || normalized === "::1") {
    return true;
  }

  const localIps = customInterfaces ? extractIpsFromInterfaces(customInterfaces) : getLocalIpAddresses();
  return localIps.has(normalized);
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
  }

  return `${Math.round(bytes / 1024)} KB`;
}

function bodyTooLargeError(limitBytes) {
  const error = new Error("BODY_TOO_LARGE");
  error.limitBytes = limitBytes;
  return error;
}

function readJsonBody(request, { maxBytes = JSON_BODY_LIMIT_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let bodyTooLarge = false;

    request.on("data", (chunk) => {
      if (bodyTooLarge) {
        return;
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;

      if (totalBytes > maxBytes) {
        bodyTooLarge = true;
        reject(bodyTooLargeError(maxBytes));
        return;
      }

      chunks.push(buffer);
    });

    request.on("end", () => {
      if (bodyTooLarge) {
        return;
      }

      const rawBody = Buffer.concat(chunks).toString("utf8");

      if (!rawBody) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(rawBody));
      } catch (error) {
        reject(new Error("INVALID_JSON"));
      }
    });

    request.on("error", reject);
  });
}

function parsePhotoPayload(body) {
  if (Array.isArray(body)) {
    return body.map(parseSinglePhoto);
  }
  return parseSinglePhoto(body);
}

function parseSinglePhoto(body) {
  const durationSeconds = Number(body.durationSeconds ?? 300);

  if (!Number.isFinite(durationSeconds)) {
    throw new Error("INVALID_PHOTO_DURATION");
  }

  const normalizedDurationSeconds = Math.floor(durationSeconds);
  if (
    normalizedDurationSeconds < PHOTO_DURATION_MIN_SECONDS ||
    normalizedDurationSeconds > PHOTO_DURATION_MAX_SECONDS
  ) {
    throw new Error("INVALID_PHOTO_DURATION");
  }

  if (typeof body.imageData !== "string") {
    throw new Error("INVALID_PHOTO_DATA");
  }

  const match = body.imageData.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) {
    throw new Error("INVALID_PHOTO_DATA");
  }

  const mimeType = match[1].toLowerCase();
  if (!PHOTO_MIME_TYPES.has(mimeType)) {
    throw new Error("INVALID_PHOTO_TYPE");
  }

  const data = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (data.length === 0 || data.length > PHOTO_DATA_LIMIT_BYTES) {
    throw new Error("PHOTO_TOO_LARGE");
  }

  return {
    data,
    mimeType,
    durationSeconds: normalizedDurationSeconds,
  };
}

async function serveStaticFile(response, publicDir, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const absolutePath = join(publicDir, safePath);
  const extension = extname(absolutePath);
  const canUseMemoryCache = !STATIC_NO_MEMORY_CACHE_EXTENSIONS.has(extension);
  const cached = canUseMemoryCache ? staticFileCache.get(absolutePath) : null;
  let body;

  if (cached) {
    body = cached.body;
  } else {
    body = await readFile(absolutePath);

    if (canUseMemoryCache && body.length <= STATIC_CACHE_MAX_BYTES) {
      staticFileCache.set(absolutePath, { body });
    }
  }

  response.writeHead(200, {
    "Content-Type": MIME_TYPES[extension] ?? "application/octet-stream",
    "Content-Length": body.length,
    "Cache-Control": canUseMemoryCache ? STATIC_CACHE_CONTROL : "no-store",
  });
  response.end(body);
}

async function serveIndexHtml(response, publicDir, token) {
  const absolutePath = join(publicDir, "index.html");
  const template = await readFile(absolutePath, "utf8");
  const body = template.replace("__MIRROR_WS_TOKEN__", escapeScriptValue(token));

  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function createWebSocketFrame(payload) {
  const payloadBytes = textEncoder.encode(payload);
  let header;

  if (payloadBytes.length <= 125) {
    header = Uint8Array.of(0x81, payloadBytes.length);
  } else if (payloadBytes.length <= 65535) {
    header = Uint8Array.of(0x81, 126, payloadBytes.length >> 8, payloadBytes.length & 0xff);
  } else {
    throw new Error("FRAME_TOO_LARGE");
  }

  const frame = new Uint8Array(header.length + payloadBytes.length);
  frame.set(header, 0);
  frame.set(payloadBytes, header.length);

  return frame;
}

const PONG_PAYLOAD = JSON.stringify({ type: "pong" });
const PONG_FRAME = createWebSocketFrame(PONG_PAYLOAD);

function handleWebSocketData(socket, data) {
  // Parse a single unmasked text WebSocket frame from a client.
  // Clients always send masked frames per RFC 6455.
  if (data.length < 6) return;
  const firstByte = data[0];
  const secondByte = data[1];
  const opcode = firstByte & 0x0f;
  const isMasked = (secondByte & 0x80) !== 0;
  if (!isMasked || opcode !== 0x01) return; // only handle masked text frames

  let payloadLength = secondByte & 0x7f;
  let maskOffset = 2;

  if (payloadLength === 126) {
    if (data.length < 8) return;
    payloadLength = (data[2] << 8) | data[3];
    maskOffset = 4;
  } else if (payloadLength === 127) {
    if (data.length < 14) return;
    payloadLength = Number((data[2] << 24) | (data[3] << 16) | (data[4] << 8) | data[5]);
    maskOffset = 8;
  }

  if (payloadLength > 65536) {
    socket.destroy();
    return;
  }

  if (data.length < maskOffset + 4 + payloadLength) return;

  const mask = data.slice(maskOffset, maskOffset + 4);
  const payloadStart = maskOffset + 4;
  const payload = Buffer.alloc(payloadLength);

  for (let i = 0; i < payloadLength; i++) {
    payload[i] = data[payloadStart + i] ^ mask[i % 4];
  }

  try {
    const message = JSON.parse(payload.toString("utf8"));
    if (message.type === "ping") {
      socket.write(PONG_FRAME);
    }
  } catch {
    // Ignore non-JSON client frames.
  }
}

function acceptWebSocketKey(key) {
  return createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
}

export function createApp({
  store,
  publicDir,
  token,
  version,
  marketService,
  newsService,
  setupService,
  hardwareManager,
  serviceName = process.env.MIRROR_SERVICE_NAME ?? "Magic Mirror",
}) {
  const sockets = new Set();
  const ipRateLimits = new Map();

  function checkRateLimit(remoteAddress, { maxRequests = 60, windowMs = 60000 } = {}) {
    if (!remoteAddress) return true;
    const now = Date.now();
    const entry = ipRateLimits.get(remoteAddress);
    if (!entry || now > entry.resetTime) {
      ipRateLimits.set(remoteAddress, { count: 1, resetTime: now + windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= maxRequests;
  }
  const scheduleInterval = setInterval(() => {
    try {
      const schedule = store.screenSchedule;
      if (!schedule || !schedule.enabled) return;

      const now = new Date();
      const currentDay = now.getDay();
      const currentHour = now.getHours().toString().padStart(2, "0");
      const currentMin = now.getMinutes().toString().padStart(2, "0");
      const currentTimeStr = `${currentHour}:${currentMin}`;

      if (!schedule.days.includes(currentDay)) return;

      if (currentTimeStr === schedule.onTime) {
        logger.info("Screen Schedule: turning display ON");
        store.setDisplayAction("on");
        broadcastState();
      } else if (currentTimeStr === schedule.offTime) {
        logger.info("Screen Schedule: turning display OFF");
        store.setDisplayAction("off");
        broadcastState();
      }
    } catch (err) {
      logger.error({ err }, "Error running screen schedule check");
    }
  }, 60 * 1000).unref();
  const getToken = typeof token === "function" ? token : () => token;
  const apiRouteMethods = new Map([
    ["/api/health", ["GET"]],
    ["/api/diagnostics", ["GET"]],
    ["/api/pairing", ["GET"]],
    ["/api/pairing/qr.svg", ["GET"]],
    ["/api/pairing/status", ["GET"]],
    ["/api/pairing/complete", ["POST"]],
    ["/api/setup/status", ["GET"]],
    ["/api/setup/wifi", ["POST"]],
    ["/api/setup/token", ["POST"]],
    ["/api/markets", ["GET"]],
    ["/api/news/tass", ["GET"]],
    ["/api/mirror/state", ["GET"]],
    ["/api/mirror/display", ["POST"]],
    ["/api/mirror/mode", ["POST"]],
    ["/api/mirror/orientation", ["POST"]],
    ["/api/mirror/layout/edit", ["POST"]],
    ["/api/mirror/photo", ["POST", "DELETE"]],
    ["/api/mirror/photo/current", ["GET"]],
    ["/api/modules", ["GET"]],
    ["/api/modules/layout", ["POST"]],
    ["/api/modules/layout/reset", ["POST"]],
    ["/api/modules/refresh-all", ["POST"]],
    ["/api/modules/batch-visibility", ["POST"]],
    ["/api/music", ["POST", "DELETE"]],
    ["/api/mirror/ar/config", ["POST"]],
    ["/api/mirror/weather/config", ["POST"]],
    ["/api/mirror/calendar/urls", ["POST"]],
    ["/api/mirror/accent", ["POST"]],
    ["/api/calendar/events", ["GET"]],
    ["/api/markets/history", ["GET"]],
    ["/api/gallery", ["GET", "POST", "DELETE"]],
    ["/api/mirror/display/schedule", ["POST"]],
    ["/api/mirror/night-mode", ["POST"]],
    ["/api/mirror/timer", ["POST", "DELETE"]],
    ["/api/mirror/note", ["POST", "DELETE"]],
  ]);
  const pairingStatus = {
    controllerConnected: false,
    controllerConnectedAt: null,
  };
  let photoOverlayTimer = null;

  function getWebSocketToken(request) {
    const url = new URL(request.url, "http://localhost");
    return url.searchParams.get("token")?.trim() || null;
  }

  function isAuthorizedToken(candidate) {
    return Boolean(candidate) && candidate === getToken();
  }

  function sendMethodNotAllowed(response, methods) {
    response.writeHead(405, {
      Allow: methods.join(", "),
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(
      JSON.stringify({
        error: "METHOD_NOT_ALLOWED",
        message: `Method must be one of: ${methods.join(", ")}.`,
      }),
    );
  }

  function broadcastState() {
    tracer.startActiveSpan("broadcastState", (span) => {
      try {
        expirePhotoOverlayIfNeeded();
        expireTimerAndNoteIfNeeded();

        const payload = JSON.stringify({
          type: "mirror_state_changed",
          payload: store.getState(),
        });

        for (const socket of sockets) {
          try {
            socket.write(createWebSocketFrame(payload));
          } catch (error) {
            socket.destroy();
            sockets.delete(socket);
          }
        }
      } finally {
        span.end();
      }
    });
  }

  function clearPhotoOverlayTimer() {
    if (photoOverlayTimer) {
      clearTimeout(photoOverlayTimer);
      photoOverlayTimer = null;
    }
  }

  function expirePhotoOverlayIfNeeded({ broadcast = false } = {}) {
    if (!store.clearExpiredPhotoOverlay()) {
      return false;
    }

    clearPhotoOverlayTimer();

    if (broadcast) {
      broadcastState();
    }

    return true;
  }

  function expireTimerAndNoteIfNeeded({ broadcast = false } = {}) {
    let changed = false;
    if (store.clearExpiredTimer()) changed = true;
    if (store.clearExpiredNote()) changed = true;
    if (changed && broadcast) {
      broadcastState();
    }
    return changed;
  }

  function schedulePhotoOverlayExpiry() {
    clearPhotoOverlayTimer();

    const photo = store.getPhotoOverlay();
    if (!photo) {
      return;
    }

    const delayMs = Math.max(0, new Date(photo.expiresAt).getTime() - Date.now());
    photoOverlayTimer = setTimeout(() => {
      photoOverlayTimer = null;
      if (store.clearExpiredPhotoOverlay()) {
        broadcastState();
      }
    }, delayMs + 25);
  }

  function broadcastPairingStatus() {
    const payload = JSON.stringify({
      type: "pairing_status_changed",
      payload: pairingStatus,
    });

    for (const socket of sockets) {
      try {
        socket.write(createWebSocketFrame(payload));
      } catch (error) {
        socket.destroy();
        sockets.delete(socket);
      }
    }
  }

  function requireAuth(request, response) {
    const bearerToken = getBearerToken(request);

    if (!isAuthorizedToken(bearerToken)) {
      json(response, 401, {
        error: "UNAUTHORIZED",
        message: "A valid bearer token is required.",
      });
      return false;
    }

    return true;
  }

  function requireLoopback(request, response) {
    if (shouldEmbedUiToken(request.socket.remoteAddress)) {
      return true;
    }

    json(response, 403, {
      error: "PAIRING_FORBIDDEN",
      message: "Pairing QR with token is only available from the mirror device itself.",
    });
    return false;
  }

  async function handlePairing(request, response, pathname, serverPort) {
    if (!requireLoopback(request, response)) {
      return true;
    }

    const payload = buildPairingPayload({
      token: getToken(),
      port: serverPort,
      service: serviceName,
    });

    if (pathname === "/api/pairing/qr.svg") {
      svg(response, 200, await buildPairingQrSvg(payload));
      return true;
    }

    json(response, 200, payload);
    return true;
  }

  async function handleSetup(request, response, pathname) {
    if (!setupService) {
      json(response, 404, {
        error: "SETUP_MODE_DISABLED",
        message: "Setup mode is disabled.",
      });
      return true;
    }

    try {
      if (request.method === "GET" && pathname === "/api/setup/status") {
        json(response, setupService.enabled ? 200 : 404, await setupService.status());
        return true;
      }

      if (request.method === "POST" && pathname === "/api/setup/wifi") {
        const body = await readJsonBody(request);
        json(response, 200, await setupService.applyWifi(body));
        return true;
      }

      if (request.method === "POST" && pathname === "/api/setup/token") {
        const body = await readJsonBody(request);
        json(response, 200, await setupService.updateToken(body));
        return true;
      }
    } catch (error) {
      if (error instanceof SetupError) {
        json(response, error.statusCode, {
          error: error.message,
          message: error.publicMessage,
        });
        return true;
      }

      throw error;
    }

    return false;
  }

  async function handleApi(request, response, pathname) {
    const routeMethods = apiRouteMethods.get(pathname);
    if (routeMethods && !routeMethods.includes(request.method)) {
      sendMethodNotAllowed(response, routeMethods);
      return;
    }

    if (request.method === "GET" && pathname === "/api/health") {
      json(response, 200, {
        status: "ok",
        version,
        name: serviceName,
        service: "_magicmirror._tcp",
        setupMode: Boolean(setupService?.enabled),
        serverTime: new Date().toISOString(),
      });
      return;
    }

    if (pathname === "/api/pairing" || pathname === "/api/pairing/qr.svg") {
      const address = request.socket.localPort ?? 8080;
      await handlePairing(request, response, pathname, address);
      return;
    }

    if (pathname.startsWith("/api/setup/")) {
      if (await handleSetup(request, response, pathname)) {
        return;
      }
    }

    const isPublicDashboardApi =
      pathname === "/api/weather" ||
      pathname.startsWith("/api/immich/") ||
      pathname === "/api/dishes" ||
      pathname === "/api/cluster";

    if (pathname.startsWith("/api/") && !isPublicDashboardApi && !requireAuth(request, response)) {
      return;
    }

    if (request.method === "GET" && pathname === "/api/diagnostics") {
      const state = store.getState();
      const memory = process.memoryUsage();
      const cpuTempCelsius = hardwareManager ? await hardwareManager.getTemperature() : null;

      json(response, 200, {
        status: "ok",
        version,
        uptimeSeconds: Math.round(process.uptime()),
        socketCount: sockets.size,
        staticCacheEntries: staticFileCache.size,
        cpuTempCelsius,
        memory: {
          rss: memory.rss,
          heapUsed: memory.heapUsed,
          heapTotal: memory.heapTotal,
        },
        mirror: {
          displayState: state.displayState,
          displayMode: state.displayMode,
          layoutEditMode: state.layoutEditMode,
          moduleCount: state.modules.length,
          visibleModuleCount: state.modules.filter((module) => module.visible).length,
          photoOverlayActive: Boolean(state.photoOverlay),
        },
        pairing: pairingStatus,
      });
      return;
    }

    if (request.method === "GET" && pathname === "/api/pairing/status") {
      json(response, 200, pairingStatus);
      return;
    }

    if (request.method === "POST" && pathname === "/api/pairing/complete") {
      pairingStatus.controllerConnected = true;
      pairingStatus.controllerConnectedAt = new Date().toISOString();
      json(response, 200, pairingStatus);
      broadcastPairingStatus();
      return;
    }

    expirePhotoOverlayIfNeeded({ broadcast: true });
    expireTimerAndNoteIfNeeded({ broadcast: true });

    if (request.method === "GET" && pathname === "/api/mirror/state") {
      json(response, 200, store.getState());
      return;
    }

    if (request.method === "GET" && pathname === "/api/modules") {
      json(response, 200, {
        modules: store.getState().modules,
      });
      return;
    }

    if (request.method === "GET" && pathname === "/api/weather") {
      const url = new URL(request.url, "http://localhost");
      const lat = parseFloat(url.searchParams.get("lat") || "55.75");
      const lon = parseFloat(url.searchParams.get("lon") || "37.62");
      json(response, 200, await getWeather(lat, lon));
      return;
    }

    
    if (request.method === "GET" && pathname === "/api/immich/stats") {
      json(response, 200, await getImmichStats());
      return;
    }

    if (request.method === "GET" && pathname === "/api/immich/photos") {
      const url = new URL(request.url, "http://localhost");
      const count = parseInt(url.searchParams.get("count") || "20", 10);
      json(response, 200, await getImmichPhotos(count));
      return;
    }

    if (request.method === "GET" && pathname.startsWith("/api/immich/photo/")) {
      const photoId = pathname.replace("/api/immich/photo/", "").trim();
      streamImmichPhoto(photoId, response);
      return;
    }

    if (request.method === "GET" && pathname === "/api/dishes") {
      const state = await getDishState();
      json(response, 200, state || {});
      return;
    }

    if (request.method === "GET" && pathname === "/api/cluster") {
      json(response, 200, await getClusterTelemetry());
      return;
    }

    if (request.method === "GET" && pathname === "/api/markets") {
      try {
        json(response, 200, await marketService.getLatest());
      } catch (error) {
        json(response, 502, {
          error: "MARKET_DATA_UNAVAILABLE",
          message: "Market data is unavailable.",
        });
      }
      return;
    }

    if (request.method === "GET" && pathname === "/api/markets/history") {
      const url = new URL(request.url, "http://localhost");
      const code = url.searchParams.get("code")?.toUpperCase() || "USD";
      try {
        const history = await marketService.getHistory(code);
        json(response, 200, history);
      } catch (error) {
        json(response, 400, {
          error: "HISTORY_DATA_UNAVAILABLE",
          message: error.message,
        });
      }
      return;
    }

    if (request.method === "GET" && pathname === "/api/news/tass") {
      try {
        json(response, 200, await newsService.getLatest());
      } catch (error) {
        json(response, 502, {
          error: "NEWS_FEED_UNAVAILABLE",
          message: "TASS RSS feed is unavailable.",
        });
      }
      return;
    }

    if (request.method === "POST" && pathname === "/api/mirror/display") {
      const body = await readJsonBody(request);

      try {
        const state = store.setDisplayAction(body.action);
        json(response, 200, state);
        broadcastState();
      } catch (error) {
        json(response, 400, {
          error: error.message,
          message: "Action must be one of on, off, or reload.",
        });
      }
      return;
    }

    if (request.method === "POST" && pathname === "/api/mirror/display/schedule") {
      const body = await readJsonBody(request);

      try {
        const state = store.setScreenSchedule(body);
        json(response, 200, state);
        broadcastState();
      } catch (error) {
        json(response, 400, {
          error: "INVALID_SCHEDULE_CONFIG",
          message: error.message,
        });
      }
      return;
    }

    if (request.method === "POST" && pathname === "/api/mirror/mode") {
      const body = await readJsonBody(request);

      try {
        const state = store.setDisplayMode(body.mode);
        json(response, 200, state);
        broadcastState();
      } catch (error) {
        json(response, 400, {
          error: error.message,
          message: "Mode must be one of mirror, gallery, or ar.",
        });
      }
      return;
    }

    if (request.method === "POST" && pathname === "/api/mirror/orientation") {
      const body = await readJsonBody(request);

      try {
        const state = store.setOrientation(body.orientation);
        json(response, 200, state);
        broadcastState();
      } catch (error) {
        json(response, 400, {
          error: error.message,
          message: "Orientation must be vertical or horizontal.",
        });
      }
      return;
    }

    if (request.method === "POST" && pathname === "/api/mirror/ar/config") {
      const body = await readJsonBody(request);

      try {
        const state = store.setArConfig(body);
        json(response, 200, state);
        broadcastState();
      } catch (error) {
        json(response, 400, {
          error: "INVALID_AR_CONFIG",
          message: error.message,
        });
      }
      return;
    }

    if (request.method === "POST" && pathname === "/api/mirror/weather/config") {
      const body = await readJsonBody(request);

      try {
        const state = store.setWeatherConfig(body);
        json(response, 200, state);
        broadcastState();
      } catch (error) {
        json(response, 400, {
          error: "INVALID_WEATHER_CONFIG",
          message: error.message,
        });
      }
      return;
    }

    if (request.method === "POST" && pathname === "/api/mirror/accent") {
      const body = await readJsonBody(request);
      try {
        const state = store.setAccent(body);
        json(response, 200, state);
        broadcastState();
      } catch (error) {
        json(response, 400, {
          error: "INVALID_ACCENT",
          message: "Accent color must include a valid 'color' string.",
        });
      }
      return;
    }

    if (request.method === "POST" && pathname === "/api/mirror/calendar/urls") {
      const body = await readJsonBody(request);

      try {
        const state = store.setCalendarUrls(body.urls);
        json(response, 200, state);
        broadcastState();
      } catch (error) {
        json(response, 400, {
          error: "INVALID_CALENDAR_URLS",
          message: error.message,
        });
      }
      return;
    }

    if (request.method === "POST" && pathname === "/api/mirror/night-mode") {
      const body = await readJsonBody(request);
      try {
        const state = store.setNightMode(body);
        json(response, 200, state);
        broadcastState();
      } catch (error) {
        json(response, 400, {
          error: "INVALID_NIGHT_MODE",
          message: error.message,
        });
      }
      return;
    }

    if (request.method === "POST" && pathname === "/api/mirror/timer") {
      const body = await readJsonBody(request);
      try {
        const state = store.setTimer(body);
        json(response, 200, state);
        broadcastState();
      } catch (error) {
        json(response, 400, {
          error: "INVALID_TIMER_CONFIG",
          message: error.message,
        });
      }
      return;
    }

    if (request.method === "DELETE" && pathname === "/api/mirror/timer") {
      const state = store.clearTimer();
      json(response, 200, state);
      broadcastState();
      return;
    }

    if (request.method === "POST" && pathname === "/api/mirror/note") {
      const body = await readJsonBody(request);
      try {
        const state = store.setNote(body);
        json(response, 200, state);
        broadcastState();
      } catch (error) {
        json(response, 400, {
          error: "INVALID_NOTE_CONFIG",
          message: error.message,
        });
      }
      return;
    }

    if (request.method === "DELETE" && pathname === "/api/mirror/note") {
      const state = store.clearNote();
      json(response, 200, state);
      broadcastState();
      return;
    }

    if (request.method === "GET" && pathname === "/api/calendar/events") {
      try {
        const upcomingEvents = await getUpcomingCalendarEvents(store.calendarUrls);
        json(response, 200, upcomingEvents);
      } catch (error) {
        json(response, 500, {
          error: "CALENDAR_FETCH_FAILED",
          message: error.message,
        });
      }
      return;
    }

    if (request.method === "GET" && pathname === "/api/gallery") {
      try {
        const galleryDir = join(publicDir, "gallery");
        const files = await readdir(galleryDir);
        const images = files
          .filter(f => /\.(jpe?g|png|webp)$/i.test(f))
          .map(f => {
            const isCustom = !standardImages.has(f);
            return {
              name: f,
              url: `/gallery/${f}`,
              isCustom
            };
          });
        json(response, 200, images);
      } catch (error) {
        json(response, 500, {
          error: "GALLERY_READ_FAILED",
          message: error.message
        });
      }
      return;
    }

    if (request.method === "POST" && pathname === "/api/gallery") {
      try {
        const body = await readJsonBody(request, { maxBytes: PHOTO_BODY_LIMIT_BYTES });
        if (typeof body.imageData !== "string") {
          throw new Error("INVALID_PHOTO_DATA");
        }
        
        const match = body.imageData.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
        if (!match) {
          throw new Error("INVALID_PHOTO_DATA");
        }
        
        const mimeType = match[1].toLowerCase();
        if (!PHOTO_MIME_TYPES.has(mimeType)) {
          throw new Error("INVALID_PHOTO_TYPE");
        }
        
        const base64Data = match[2];
        const buffer = Buffer.from(base64Data, "base64");
        
        if (buffer.length > PHOTO_DATA_LIMIT_BYTES) {
          throw new Error("PHOTO_TOO_LARGE");
        }
        
        const ext = mimeType === "image/png" ? ".png" : mimeType === "image/webp" ? ".webp" : ".jpg";
        const filename = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
        const filePath = join(publicDir, "gallery", filename);
        
        await writeFile(filePath, buffer);
        
        json(response, 200, {
          status: "ok",
          name: filename,
          url: `/gallery/${filename}`,
          isCustom: true
        });
      } catch (error) {
        if (error.message === "PHOTO_TOO_LARGE") {
          json(response, 413, {
            error: error.message,
            message: `Photo must be ${formatBytes(PHOTO_DATA_LIMIT_BYTES)} or smaller.`,
          });
        } else if (["INVALID_PHOTO_DATA", "INVALID_PHOTO_TYPE"].includes(error.message)) {
          json(response, 400, {
            error: error.message,
            message: "Photo must be a JPEG, PNG, or WebP data URL.",
          });
        } else {
          json(response, 500, {
            error: "GALLERY_UPLOAD_FAILED",
            message: error.message,
          });
        }
      }
      return;
    }

    if (request.method === "DELETE" && pathname === "/api/gallery") {
      try {
        const url = new URL(request.url, "http://localhost");
        const filename = url.searchParams.get("filename");
        if (!filename) {
          throw new Error("MISSING_FILENAME");
        }
        
        if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
          throw new Error("INVALID_FILENAME");
        }
        
        if (standardImages.has(filename)) {
          throw new Error("CANNOT_DELETE_STANDARD_IMAGE");
        }
        
        const filePath = join(publicDir, "gallery", filename);
        await unlink(filePath);
        
        json(response, 200, { status: "ok" });
      } catch (error) {
        if (error.message === "CANNOT_DELETE_STANDARD_IMAGE") {
          json(response, 403, {
            error: error.message,
            message: "Standard gallery images cannot be deleted."
          });
        } else if (error.message === "INVALID_FILENAME") {
          json(response, 400, {
            error: error.message,
            message: "Invalid filename."
          });
        } else if (error.message === "MISSING_FILENAME") {
          json(response, 400, {
            error: error.message,
            message: "Filename parameter is missing."
          });
        } else {
          json(response, 500, {
            error: "GALLERY_DELETE_FAILED",
            message: error.message
          });
        }
      }
      return;
    }

    if (request.method === "POST" && pathname === "/api/mirror/layout/edit") {
      const body = await readJsonBody(request);

      try {
        const state = store.setLayoutEditMode(body.active);
        json(response, 200, state);
        broadcastState();
      } catch (error) {
        json(response, 400, {
          error: error.message,
          message: "Active must be a boolean value.",
        });
      }
      return;
    }

    if (request.method === "POST" && pathname === "/api/mirror/photo") {
      if (!checkRateLimit(request.socket.remoteAddress, { maxRequests: 30, windowMs: 60000 })) {
        json(response, 429, {
          error: "TOO_MANY_REQUESTS",
          message: "Too many photo upload requests. Please wait a moment.",
        });
        return;
      }

      try {
        const body = await readJsonBody(request, { maxBytes: PHOTO_BODY_LIMIT_BYTES });
        const state = store.setPhotoOverlay(parsePhotoPayload(body));
        schedulePhotoOverlayExpiry();
        json(response, 200, state);
        broadcastState();
      } catch (error) {
        if (error.message === "PHOTO_TOO_LARGE") {
          json(response, 413, {
            error: error.message,
            message: `Photo must be ${formatBytes(PHOTO_DATA_LIMIT_BYTES)} or smaller after processing.`,
          });
          return;
        }

        if (
          [
            "INVALID_PHOTO_DATA",
            "INVALID_PHOTO_TYPE",
            "INVALID_PHOTO_DURATION",
          ].includes(error.message)
        ) {
          json(response, 400, {
            error: error.message,
            message: "Photo must be a JPEG, PNG, or WebP data URL. Duration must be 1 to 3600 seconds.",
          });
          return;
        }

        throw error;
      }
      return;
    }

    if (request.method === "DELETE" && pathname === "/api/mirror/photo") {
      clearPhotoOverlayTimer();
      const state = store.clearPhotoOverlay();
      json(response, 200, state);
      broadcastState();
      return;
    }

    if (request.method === "GET" && pathname === "/api/mirror/photo/current") {
      const url = new URL(request.url, "http://localhost");
      const id = url.searchParams.get("id");
      const photo = store.getPhotoOverlay(id);

      if (!photo) {
        json(response, 404, {
          error: "PHOTO_NOT_FOUND",
          message: "No temporary photo is active.",
        });
        return;
      }

      binary(response, 200, photo.data, photo.mimeType);
      return;
    }

    if (request.method === "POST" && pathname === "/api/modules/layout") {
      const body = await readJsonBody(request);

      try {
        const state = await store.setModuleLayout(body.modules);
        json(response, 200, state);
        broadcastState();
      } catch (error) {
        const statusCode = error.message === "MODULE_NOT_FOUND" ? 404 : 400;
        json(response, statusCode, {
          error: error.message,
          message:
            error.message === "MODULE_NOT_FOUND"
              ? "Module was not found."
              : "Layout coordinates and size must keep every widget inside the screen.",
        });
      }
      return;
    }

    if (request.method === "POST" && pathname === "/api/modules/layout/reset") {
      const state = await store.resetModuleLayout();
      json(response, 200, state);
      broadcastState();
      return;
    }

    const visibilityMatch = pathname.match(/^\/api\/modules\/([^/]+)\/visibility$/);
    if (visibilityMatch && request.method !== "POST") {
      sendMethodNotAllowed(response, ["POST"]);
      return;
    }

    if (request.method === "POST" && visibilityMatch) {
      const body = await readJsonBody(request);

      try {
        const state = store.setModuleVisibility(
          decodeURIComponent(visibilityMatch[1]),
          body.visible,
        );
        json(response, 200, state);
        broadcastState();
      } catch (error) {
        const statusCode = error.message === "MODULE_NOT_FOUND" ? 404 : 400;
        json(response, statusCode, {
          error: error.message,
          message:
            error.message === "MODULE_NOT_FOUND"
              ? "Module was not found."
              : "Visible must be a boolean value.",
        });
      }
      return;
    }

    const refreshMatch = pathname.match(/^\/api\/modules\/([^/]+)\/refresh$/);
    if (refreshMatch && request.method !== "POST") {
      sendMethodNotAllowed(response, ["POST"]);
      return;
    }

    if (request.method === "POST" && refreshMatch) {
      try {
        const state = store.refreshModule(decodeURIComponent(refreshMatch[1]));
        json(response, 200, state);
        broadcastState();
      } catch (error) {
        json(response, 404, {
          error: error.message,
          message: "Module was not found.",
        });
      }
      return;
    }

    if (request.method === "POST" && pathname === "/api/modules/refresh-all") {
      const state = store.refreshAll();
      json(response, 200, state);
      broadcastState();
      return;
    }

    if (request.method === "POST" && pathname === "/api/modules/batch-visibility") {
      const body = await readJsonBody(request);
      const updates = body.modules;

      if (!Array.isArray(updates)) {
        json(response, 400, {
          error: "INVALID_PAYLOAD",
          message: "modules must be an array of { id, visible } objects.",
        });
        return;
      }

      try {
        let state;
        for (const item of updates) {
          state = store.setModuleVisibility(item.id, Boolean(item.visible));
        }
        json(response, 200, state ?? store.getState());
        broadcastState();
      } catch (error) {
        const statusCode = error.message === "MODULE_NOT_FOUND" ? 404 : 400;
        json(response, statusCode, {
          error: error.message,
          message: error.message === "MODULE_NOT_FOUND" ? "Module was not found." : "Invalid visibility value.",
        });
      }
      return;
    }

    if (request.method === "POST" && pathname === "/api/music") {
      const body = await readJsonBody(request, { maxBytes: 1024 * 1024 * 2 }); // Allow up to 2MB for album art base64
      try {
        const state = store.setMusic(body);
        json(response, 200, state);
        broadcastState();
      } catch (error) {
        json(response, 400, {
          error: error.message,
          message: "Invalid music payload.",
        });
      }
      return;
    }

    if (request.method === "DELETE" && pathname === "/api/music") {
      const state = store.clearMusic();
      json(response, 200, state);
      broadcastState();
      return;
    }

    if (request.method === "POST" && pathname === "/api/mirror/chart/currency") {
      const body = await readJsonBody(request);
      const code = body?.code;
      const validCodes = ["USD", "EUR", "CNY", "BTC", "ETH"];

      if (!code || !validCodes.includes(code)) {
        json(response, 400, {
          error: "INVALID_CURRENCY",
          message: `Currency code must be one of: ${validCodes.join(", ")}.`,
        });
        return;
      }

      // Broadcast targeted event to all mirror clients
      const payload = JSON.stringify({
        type: "chart_currency_changed",
        payload: { code },
      });

      for (const socket of sockets) {
        try {
          socket.write(createWebSocketFrame(payload));
        } catch (error) {
          socket.destroy();
          sockets.delete(socket);
        }
      }

      json(response, 200, { ok: true, code });
      return;
    }

    json(response, 404, {
      error: "NOT_FOUND",
      message: "Route not found.",
    });
  }

  async function handleRequest(request, response) {
    httpLogger(request, response);

    try {
      const url = new URL(request.url, "http://localhost");

      if (url.pathname.startsWith("/api/")) {
        const startTime = performance.now();
        await tracer.startActiveSpan(`API ${request.method} ${url.pathname}`, async (span) => {
          try {
            await handleApi(request, response, url.pathname);
          } finally {
            span.end();
            const duration = performance.now() - startTime;
            if (apiLatencyHistogram) {
              apiLatencyHistogram.record(duration, { method: request.method, route: url.pathname });
            }
          }
        });
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        json(response, 405, {
          error: "METHOD_NOT_ALLOWED",
          message: "Static assets only support GET and HEAD.",
        });
        return;
      }

      if (url.pathname === "/") {
        const uiToken = shouldEmbedUiToken(request.socket.remoteAddress) ? getToken() : "";
        await serveIndexHtml(response, publicDir, uiToken);
        return;
      }

      await serveStaticFile(response, publicDir, url.pathname);
    } catch (error) {
      incrementApiError();

      if (error.message === "BODY_TOO_LARGE") {
        json(response, 413, {
          error: "BODY_TOO_LARGE",
          message: `Request body must be ${formatBytes(error.limitBytes ?? JSON_BODY_LIMIT_BYTES)} or smaller.`,
        });
        return;
      }

      if (error.message === "INVALID_JSON") {
        json(response, 400, {
          error: "INVALID_JSON",
          message: "Body must be valid JSON.",
        });
        return;
      }

      if (error.code === "ENOENT") {
        json(response, 404, {
          error: "NOT_FOUND",
          message: "File not found.",
        });
        return;
      }

      json(response, 500, {
        error: "INTERNAL_SERVER_ERROR",
        message: "Unexpected server error.",
      });
    }
  }

  function handleUpgrade(request, socket) {
    const url = new URL(request.url, "http://localhost");

    if (url.pathname !== "/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    const webSocketToken = getWebSocketToken(request);
    if (!isAuthorizedToken(webSocketToken)) {
      socket.write(
        "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json; charset=utf-8\r\n\r\n",
      );
      socket.destroy();
      return;
    }

    const webSocketKey = request.headers["sec-websocket-key"];

    if (!webSocketKey) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${acceptWebSocketKey(webSocketKey)}`,
        "",
        "",
      ].join("\r\n"),
    );

    socket.setNoDelay?.(true);
    socket.setKeepAlive?.(true, 30000);
    sockets.add(socket);
    setWsClientCount(sockets.size);
    const removeSocket = () => {
      sockets.delete(socket);
      setWsClientCount(sockets.size);
    };
    socket.on("close", removeSocket);
    socket.on("error", removeSocket);
    socket.on("end", removeSocket);
    socket.on("data", (chunk) => handleWebSocketData(socket, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));

    try {
      socket.write(
        createWebSocketFrame(
          JSON.stringify({
            type: "mirror_state_changed",
            payload: store.getState(),
          }),
        ),
      );
      socket.write(
        createWebSocketFrame(
          JSON.stringify({
            type: "pairing_status_changed",
            payload: pairingStatus,
          }),
        ),
      );
    } catch (error) {
      socket.destroy();
      sockets.delete(socket);
    }
  }

  return {
    closeSockets() {
      clearInterval(scheduleInterval);
      clearPhotoOverlayTimer();

      for (const socket of sockets) {
        socket.destroy();
      }

      sockets.clear();
    },
    handleRequest,
    handleUpgrade,
  };
}
