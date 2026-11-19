import { logger } from "./logger.js";

const apiKey = process.env.OTEL_API_KEY || process.env.TELEMETRY_API_KEY || "";
const otelEndpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "https://ingest.dada-tuda.ru").replace(/\/+$/, "");
const metricsUrl = process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || `${otelEndpoint}/v1/metrics`;
const logsUrl = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || `${otelEndpoint}/v1/logs`;
const tracesUrl = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || `${otelEndpoint}/v1/traces`;
const serviceName = process.env.OTEL_SERVICE_NAME || "magic-mirror";

let sdk = null;
let activeTracer = null;

const noopSpan = {
  end() {},
  recordException() {},
  setStatus() {},
  setAttribute() {},
  setAttributes() {},
};

export const tracer = {
  startActiveSpan(name, fn) {
    if (activeTracer) {
      return activeTracer.startActiveSpan(name, fn);
    }
    return fn(noopSpan);
  },
};

export async function initTelemetry() {
  const isEnabled = process.env.ENABLE_TELEMETRY === "true" || process.env.ENABLE_TELEMETRY === "1";
  if (!isEnabled || !apiKey) {
    logger.info("OpenTelemetry is disabled or OTEL_API_KEY is not configured.");
    return;
  }

  try {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-http");
    const { PeriodicExportingMetricReader } = await import("@opentelemetry/sdk-metrics");
    const { OTLPLogExporter } = await import("@opentelemetry/exporter-logs-otlp-http");
    const { BatchLogRecordProcessor } = await import("@opentelemetry/sdk-logs");
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const { resourceFromAttributes } = await import("@opentelemetry/resources");
    const { PinoInstrumentation } = await import("@opentelemetry/instrumentation-pino");
    const { HttpInstrumentation } = await import("@opentelemetry/instrumentation-http");
    const { diag, DiagConsoleLogger, DiagLogLevel, trace } = await import("@opentelemetry/api");
    const { HostMetrics } = await import("@opentelemetry/host-metrics");

    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
    activeTracer = trace.getTracer(serviceName);

    sdk = new NodeSDK({
      resource: resourceFromAttributes({
        "service.name": serviceName,
      }),
      traceExporter: new OTLPTraceExporter({
        url: tracesUrl,
        headers: { "X-API-Key": apiKey },
      }),
      metricReaders: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url: metricsUrl,
            headers: { "X-API-Key": apiKey },
          }),
        }),
      ],
      logRecordProcessors: [
        new BatchLogRecordProcessor(
          new OTLPLogExporter({
            url: logsUrl,
            headers: { "X-API-Key": apiKey },
          })
        ),
      ],
      instrumentations: [
        new PinoInstrumentation(),
        new HttpInstrumentation(),
      ],
    });

    sdk.start();

    const hostMetrics = new HostMetrics({ name: "system-host-metrics" });
    hostMetrics.start();

    process.on("uncaughtException", async (error) => {
      logger.fatal({ err: error }, "Uncaught Exception - crashing");
      if (sdk) await sdk.shutdown();
      process.exit(1);
    });

    process.on("unhandledRejection", async (reason, promise) => {
      logger.fatal({ err: reason, promise }, "Unhandled Rejection - crashing");
      if (sdk) await sdk.shutdown();
      process.exit(1);
    });

    process.on("SIGTERM", () => {
      if (sdk) {
        sdk.shutdown()
          .then(() => console.log("OpenTelemetry SDK shut down successfully"))
          .catch((error) => console.log("Error shutting down OpenTelemetry SDK", error));
      }
    });
  } catch (err) {
    logger.warn({ err }, "Failed to initialize OpenTelemetry SDK; running with local telemetry");
  }
}
