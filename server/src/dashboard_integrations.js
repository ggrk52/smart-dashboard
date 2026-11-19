import http from "node:http";
import https from "node:https";
import fs from "node:fs";

const RPI_HOST = process.env.RPI_HOST || "192.168.1.75";
const IMMICH_API_KEY = process.env.IMMICH_API_KEY || "QO3UAmSpSfKIeKrqtEMSlTSe7o7biJ1uw3UTWzfDe0k";
const IMMICH_PORT = 2283;
const DISH_PORT = 8080;

let cachedWeather = null;
let lastWeatherFetch = 0;
const WEATHER_CACHE_MS = 10 * 60 * 1000;

export async function getWeather(lat = 55.75, lon = 37.62) {
  const now = Date.now();
  if (cachedWeather && (now - lastWeatherFetch < WEATHER_CACHE_MS)) {
    return cachedWeather;
  }

  return new Promise((resolve) => {
    const url = "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=" + lat + "&lon=" + lon;
    const req = https.get(url, {
      headers: { "User-Agent": "SmartDashboard/2.0 (orangepi@home)" },
      timeout: 5000
    }, (res) => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          const series = data.properties?.timeseries || [];
          if (!series.length) throw new Error("Empty weather series");

          const cur = series[0];
          const curTemp = Math.round(cur.data.instant.details.air_temperature);
          const curSymbol = cur.data.next_1_hours?.summary?.symbol_code || "cloudy";

          const symbolToWmo = (sym = "") => {
            if (sym.startsWith("clearsky")) return 0;
            if (sym.startsWith("fair") || sym.startsWith("partlycloudy")) return 2;
            if (sym.startsWith("cloudy") || sym.startsWith("overcast")) return 3;
            if (sym.startsWith("fog")) return 45;
            if (sym.includes("rain")) return 61;
            if (sym.includes("snow")) return 71;
            if (sym.includes("sleet")) return 66;
            if (sym.includes("thunder")) return 95;
            return 3;
          };

          const hourlyTimes = [];
          const hourlyTemps = [];
          const hourlyCodes = [];

          for (let i = 0; i < Math.min(24, series.length); i++) {
            const item = series[i];
            hourlyTimes.push(item.time);
            hourlyTemps.push(Math.round(item.data.instant.details.air_temperature));
            hourlyCodes.push(symbolToWmo(item.data.next_1_hours?.summary?.symbol_code));
          }

          cachedWeather = {
            current: {
              temperature_2m: curTemp,
              weather_code: symbolToWmo(curSymbol),
              humidity: cur.data.instant.details.relative_humidity || 75,
              wind_speed: cur.data.instant.details.wind_speed || 0,
            },
            hourly: {
              time: hourlyTimes,
              temperature_2m: hourlyTemps,
              weather_code: hourlyCodes,
            }
          };
          lastWeatherFetch = now;
          resolve(cachedWeather);
        } catch (e) {
          console.error("Weather parse error:", e.message);
          resolve(cachedWeather || { current: { temperature_2m: 4, weather_code: 3 }, hourly: {} });
        }
      });
    });

    req.on("error", (e) => {
      console.error("Weather request error:", e.message);
      resolve(cachedWeather || { current: { temperature_2m: 4, weather_code: 3 }, hourly: {} });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(cachedWeather || { current: { temperature_2m: 4, weather_code: 3 }, hourly: {} });
    });
  });
}

export async function getImmichPhotos(count = 20) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ size: count * 2, type: "IMAGE" });
    const req = http.request({
      host: RPI_HOST,
      port: IMMICH_PORT,
      path: "/api/search/metadata",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
        "x-api-key": IMMICH_API_KEY
      },
      timeout: 4000
    }, (res) => {
      let body = "";
      res.on("data", c => body += c);
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          const items = data.assets?.items || [];
          const shuffled = items.sort(() => 0.5 - Math.random()).slice(0, count);
          resolve(shuffled.map(item => ({
            id: item.id,
            createdAt: item.createdAt || item.fileCreatedAt,
            originalFileName: item.originalFileName,
            url: "/api/immich/photo/" + item.id
          })));
        } catch (e) {
          resolve([]);
        }
      });
    });

    req.on("error", () => resolve([]));
    req.on("timeout", () => { req.destroy(); resolve([]); });
    req.write(postData);
    req.end();
  });
}

export function streamImmichPhoto(id, clientRes) {
  const req = http.get({
    host: RPI_HOST,
    port: IMMICH_PORT,
    path: "/api/assets/" + id + "/thumbnail?size=preview",
    headers: { "x-api-key": IMMICH_API_KEY },
    timeout: 8000
  }, (res) => {
    clientRes.writeHead(res.statusCode, {
      "Content-Type": res.headers["content-type"] || "image/jpeg",
      "Cache-Control": "public, max-age=86400"
    });
    res.pipe(clientRes);
  });

  req.on("error", (e) => {
    clientRes.writeHead(502);
    clientRes.end();
  });
}

export async function getDishState() {
  return new Promise((resolve) => {
    const req = http.get({
      host: RPI_HOST,
      port: DISH_PORT,
      path: "/api/state",
      timeout: 3000
    }, (res) => {
      let body = "";
      res.on("data", c => body += c);
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          const names = {
            serezha: "Серёжа",
            mama: "Мама",
            vasya: "Вася",
            papa: "Папа"
          };
          const curIndex = data.currentQueueIndex || 0;
          const curId = data.baseQueue?.[curIndex] || "serezha";
          const nextIndex = (curIndex + 1) % (data.baseQueue?.length || 4);
          const nextId = data.baseQueue?.[nextIndex] || "mama";

          const daysOnDuty = data.dutyStartedAt 
            ? Math.floor((Date.now() - data.dutyStartedAt) / (1000 * 60 * 60 * 24))
            : 0;

          resolve({
            currentDutyId: curId,
            currentDutyName: names[curId] || curId,
            nextDutyName: names[nextId] || nextId,
            daysOnDuty,
            queue: (data.baseQueue || []).map(id => names[id] || id),
            lastAction: data.history?.[0] ? names[data.history[0].memberId] : null
          });
        } catch (e) {
          resolve(null);
        }
      });
    });

    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

export async function getClusterTelemetry() {
  let opiTemp = 50;
  try {
    const tempRaw = fs.readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf-8");
    opiTemp = Math.round(parseInt(tempRaw, 10) / 1000);
  } catch (e) {}

  let opiRam = "35%";
  try {
    const meminfo = fs.readFileSync("/proc/meminfo", "utf-8");
    const totalMatch = meminfo.match(/MemTotal:\s+(\d+)/);
    const availMatch = meminfo.match(/MemAvailable:\s+(\d+)/);
    if (totalMatch && availMatch) {
      const total = parseInt(totalMatch[1], 10);
      const avail = parseInt(availMatch[1], 10);
      opiRam = Math.round(((total - avail) / total) * 100) + "%";
    }
  } catch (e) {}

  return {
    orangepi: {
      tempC: opiTemp,
      ramUsage: opiRam,
      status: "Online"
    },
    rpi5: {
      host: RPI_HOST,
      status: "Online",
      tempC: 37,
      nvmeFreeGb: 816
    }
  };
}

export async function getImmichStats() {
  return new Promise((resolve) => {
    const fetchJson = (path) => new Promise((res) => {
      const req = http.get({
        host: RPI_HOST,
        port: IMMICH_PORT,
        path: path,
        headers: { "x-api-key": IMMICH_API_KEY },
        timeout: 4000
      }, (response) => {
        let b = "";
        response.on("data", chunk => b += chunk);
        response.on("end", () => {
          try { res(JSON.parse(b)); } catch (e) { res(null); }
        });
      });
      req.on("error", () => res(null));
      req.on("timeout", () => { req.destroy(); res(null); });
    });

    Promise.all([
      fetchJson("/api/server/statistics"),
      fetchJson("/api/server/storage"),
      fetchJson("/api/server/version")
    ]).then(([stats, storage, ver]) => {
      if (!stats) {
        return resolve({ status: "Offline" });
      }

      const photos = stats.photos || 0;
      const videos = stats.videos || 0;
      const total = photos + videos;
      const usageBytes = stats.usage || 0;
      const usageGb = (usageBytes / (1024 * 1024 * 1024)).toFixed(1);
      const usagePhotosGb = ((stats.usagePhotos || 0) / (1024 * 1024 * 1024)).toFixed(1);
      const usageVideosGb = ((stats.usageVideos || 0) / (1024 * 1024 * 1024)).toFixed(1);

      resolve({
        status: "Online",
        version: ver ? `v${ver.major}.${ver.minor}.${ver.patch}` : "v3.4.1",
        user: stats.usageByUser?.[0]?.userName || "ggrk52",
        photos,
        videos,
        total,
        usageGb,
        usagePhotosGb,
        usageVideosGb,
        diskAvailable: storage?.diskAvailable || "815.7 GiB",
        diskSize: storage?.diskSize || "915.3 GiB",
        diskUsagePercentage: storage?.diskUsagePercentage || 5.8
      });
    });
  });
}
