const CBR_DAILY_URL = "https://www.cbr-xml-daily.ru/daily_json.js";
const COINGECKO_PRICE_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=rub&include_24hr_change=true";
const CACHE_TTL_MS = 2 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3500;
import { logger } from "./logger.js";

function toNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fiatRate(label, code, data) {
  const nominal = toNumber(data?.Nominal) ?? 1;
  const value = toNumber(data?.Value);
  const previous = toNumber(data?.Previous);

  return {
    label,
    code,
    valueRub: value === null ? null : value / nominal,
    previousRub: previous === null ? null : previous / nominal,
  };
}

function cryptoRate(label, code, data) {
  return {
    label,
    code,
    valueRub: toNumber(data?.rub),
    change24hPct: toNumber(data?.rub_24h_change),
  };
}

export function buildMarketSnapshot(cbrPayload, cryptoPayload) {
  return {
    fetchedAt: new Date().toISOString(),
    fiat: [
      fiatRate("Доллар", "USD", cbrPayload?.Valute?.USD),
      fiatRate("Евро", "EUR", cbrPayload?.Valute?.EUR),
      fiatRate("Юань", "CNY", cbrPayload?.Valute?.CNY),
    ],
    crypto: [
      cryptoRate("Bitcoin", "BTC", cryptoPayload?.bitcoin),
      cryptoRate("Ethereum", "ETH", cryptoPayload?.ethereum),
    ],
  };
}

export function createMarketService({
  fetchImpl = globalThis.fetch,
  cbrUrl = CBR_DAILY_URL,
  coinGeckoUrl = COINGECKO_PRICE_URL,
  cacheTtlMs = CACHE_TTL_MS,
  fetchTimeoutMs = FETCH_TIMEOUT_MS,
} = {}) {
  let cache = null;
  let cacheFetchedAtMs = 0;
  let inFlight = null;
  let intervalId = null;

  async function fetchJson(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);

    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "MagicMirrorLAN/1.0 (+local mirror display)",
      },
    }).finally(() => {
      clearTimeout(timeout);
    });

    if (!response.ok) {
      throw new Error(`MARKET_HTTP_${response.status}`);
    }

    return response.json();
  }

  async function fetchLatest() {
    const [cbrPayload, cryptoPayload] = await Promise.all([
      fetchJson(cbrUrl).catch((error) => {
        logger.warn(`Failed to fetch CBR daily rates: ${error.message}`);
        return null;
      }),
      fetchJson(coinGeckoUrl).catch((error) => {
        logger.warn(`Failed to fetch CoinGecko rates: ${error.message}`);
        return null;
      }),
    ]);

    if (!cbrPayload && !cryptoPayload) {
      throw new Error("Both market data feeds failed to load.");
    }

    cache = buildMarketSnapshot(cbrPayload, cryptoPayload);
    cacheFetchedAtMs = Date.now();
    return cache;
  }

  return {
    startPolling() {
      if (intervalId) return;
      fetchLatest().catch(() => {});
      intervalId = setInterval(() => {
        fetchLatest().catch(() => {});
      }, cacheTtlMs);
      if (intervalId && typeof intervalId.unref === "function") {
        intervalId.unref();
      }
    },
    stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    async getLatest() {
      if (cache && Date.now() - cacheFetchedAtMs < cacheTtlMs) {
        return {
          ...cache,
          cached: true,
        };
      }

      if (cache) {
        if (!inFlight) {
          inFlight = fetchLatest()
            .catch(() => {})
            .finally(() => {
              inFlight = null;
            });
        }
        return {
          ...cache,
          cached: true,
        };
      }

      try {
        inFlight ??= fetchLatest().finally(() => {
          inFlight = null;
        });

        return {
          ...(await inFlight),
          cached: false,
        };
      } catch (error) {
        if (cache) {
          return {
            ...cache,
            cached: true,
          };
        }

        throw error;
      }
    },
    async getHistory(code) {
      const cached = historyCache.get(code);
      if (cached && Date.now() - cached.fetchedAtMs < cacheTtlMs * 30) {
        return cached.data;
      }
      
      let data;
      if (FIAT_VAL_IDS[code]) {
        const valId = FIAT_VAL_IDS[code];
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - 30);
        
        const formatDate = (d) => {
          const day = d.getDate().toString().padStart(2, "0");
          const month = (d.getMonth() + 1).toString().padStart(2, "0");
          const year = d.getFullYear();
          return `${day}/${month}/${year}`;
        };
        
        const url = `https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=${formatDate(startDate)}&date_req2=${formatDate(endDate)}&VAL_NM_RQ=${valId}`;
        const resText = await fetchJsonXml(url);
        data = parseCbrXmlDynamic(resText);
      } else if (CRYPTO_COIN_IDS[code]) {
        const coinId = CRYPTO_COIN_IDS[code];
        const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=rub&days=30&interval=daily`;
        const resJson = await fetchJson(url);
        data = (resJson.prices ?? []).map(p => ({
          date: new Date(p[0]).toISOString(),
          valueRub: p[1]
        }));
      } else {
        throw new Error("INVALID_CURRENCY_CODE");
      }
      
      historyCache.set(code, { fetchedAtMs: Date.now(), data });
      return data;
    }
  };
}

const FIAT_VAL_IDS = {
  USD: "R01235",
  EUR: "R01239",
  CNY: "R01375"
};

const CRYPTO_COIN_IDS = {
  BTC: "bitcoin",
  ETH: "ethereum"
};

const historyCache = new Map();

async function fetchJsonXml(url, fetchImpl = globalThis.fetch, fetchTimeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);

  const response = await fetchImpl(url, {
    signal: controller.signal,
    headers: {
      "User-Agent": "MagicMirrorLAN/1.0 (+local mirror display)",
    },
  }).finally(() => {
    clearTimeout(timeout);
  });

  if (!response.ok) {
    throw new Error(`MARKET_HTTP_${response.status}`);
  }

  return response.text();
}

function parseCbrXmlDynamic(xmlText) {
  const records = [];
  const regex = /<Record Date="([^"]+)"[^>]*>\s*<Nominal>([^<]+)<\/Nominal>\s*<Value>([^<]+)<\/Value>/g;
  let match;
  while ((match = regex.exec(xmlText)) !== null) {
    const dateStr = match[1];
    const nominal = parseFloat(match[2].replace(",", "."));
    const value = parseFloat(match[3].replace(",", "."));
    
    const parts = dateStr.split(".");
    const date = new Date(parts[2], parts[1] - 1, parts[0]);
    
    records.push({
      date: date.toISOString(),
      valueRub: value / nominal
    });
  }
  return records;
}
