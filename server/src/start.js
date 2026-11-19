import { initTelemetry } from "./telemetry.js";

// Initialize OpenTelemetry before importing any other modules (like pino or server components)
initTelemetry();

// Now import the main application entry point
import("./index.js").catch((err) => {
  console.error("Failed to start application:", err);
  process.exit(1);
});
