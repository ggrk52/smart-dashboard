import os from "node:os";
import { logger } from "./logger.js";
import checkDiskSpace from "check-disk-space";
import { performance } from "node:perf_hooks";

let metricsInterval = null;
let meter = null;
let cpuTempGauge = null;
let memUsageGauge = null;
let cpuLoadGauge = null;
let diskFreeGauge = null;
let wsClientsGauge = null;
let apiErrorsCounter = null;
export let apiLatencyHistogram = null;

let lastTemp = 0;
let lastMemUsage = 0;
let lastCpuLoad = 0;
let lastDiskFreePercent = 0;
let lastElu = performance.eventLoopUtilization();

let currentWsClients = 0;

export function setWsClientCount(count) {
  currentWsClients = count;
}

export function incrementApiError() {
  if (apiErrorsCounter) {
    apiErrorsCounter.add(1);
  }
}

export async function startMetricsLogging(hardwareManager, intervalMs = 60000) {
  if (metricsInterval) {
    clearInterval(metricsInterval);
  }

  const isOtelEnabled = process.env.ENABLE_TELEMETRY === "true" || process.env.ENABLE_TELEMETRY === "1";
  if (isOtelEnabled && !meter) {
    try {
      const { metrics } = await import("@opentelemetry/api");
      meter = metrics.getMeter("magic-mirror-hardware-metrics");
      
      cpuTempGauge = meter.createObservableGauge("system.cpu.temperature", {
        description: "CPU Temperature in Celsius",
        unit: "C",
      });
      cpuTempGauge.addCallback((result) => {
        if (lastTemp !== null) result.observe(lastTemp);
      });

      memUsageGauge = meter.createObservableGauge("system.memory.usage_percent", {
        description: "Memory usage percentage",
        unit: "%",
      });
      memUsageGauge.addCallback((result) => {
        result.observe(lastMemUsage);
      });

      cpuLoadGauge = meter.createObservableGauge("system.cpu.load_avg_1m", {
        description: "CPU load average over 1 minute",
      });
      cpuLoadGauge.addCallback((result) => {
        result.observe(lastCpuLoad);
      });

      diskFreeGauge = meter.createObservableGauge("system.disk.free_percent", {
        description: "Free disk space percentage",
        unit: "%",
      });
      diskFreeGauge.addCallback((result) => {
        result.observe(lastDiskFreePercent);
      });

      wsClientsGauge = meter.createObservableGauge("system.network.ws_clients", {
        description: "Active WebSocket connections",
      });
      wsClientsGauge.addCallback((result) => {
        result.observe(currentWsClients);
      });

      apiErrorsCounter = meter.createCounter("mirror.api.errors_total", {
        description: "Total API errors (4xx and 5xx)",
      });

      apiLatencyHistogram = meter.createHistogram("mirror.api.latency", {
        description: "API response time in milliseconds",
        unit: "ms",
      });

      meter.createObservableGauge("nodejs.event_loop.utilization", {
        description: "Event loop utilization",
      }).addCallback((result) => {
        const currentElu = performance.eventLoopUtilization();
        const eluDelta = performance.eventLoopUtilization(currentElu, lastElu);
        lastElu = currentElu;
        result.observe(eluDelta.utilization);
      });

      meter.createObservableGauge("nodejs.memory.heap_used", {
        description: "Node.js heap used in bytes",
        unit: "By",
      }).addCallback((result) => {
        result.observe(process.memoryUsage().heapUsed);
      });
    } catch (err) {
      logger.warn({ err }, "Could not initialize OpenTelemetry metrics meter; logging locally.");
    }
  }

  metricsInterval = setInterval(async () => {
    try {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      lastMemUsage = (usedMem / totalMem) * 100;
      
      const loadAvg = os.loadavg();
      lastCpuLoad = loadAvg[0];
      
      try {
        const diskSpace = await checkDiskSpace(process.cwd());
        lastDiskFreePercent = (diskSpace.free / diskSpace.size) * 100;
      } catch (e) {
        // Ignored
      }
      
      let temp = null;
      if (hardwareManager) {
        temp = await hardwareManager.getTemperature();
      }
      lastTemp = temp;
      
      logger.info({
        cpuTemperature: lastTemp,
        cpuLoadAvg: lastCpuLoad,
        memoryUsagePercent: lastMemUsage.toFixed(2),
        diskFreePercent: lastDiskFreePercent.toFixed(2),
        activeWsClients: currentWsClients,
      }, "System hardware load metrics");
    } catch (error) {
      logger.error({ err: error }, "Failed to collect system metrics");
    }
  }, intervalMs);
}

export function stopMetricsLogging() {
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
  }
}
