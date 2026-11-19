import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "./logger.js";

const execAsync = promisify(exec);

// Sysfs paths for screen power control
const FB_BLANK_PATH = "/sys/class/graphics/fb0/blank";
const THERMAL_BASE = "/sys/class/thermal";
const BACKLIGHT_BASE = "/sys/class/backlight";

export class HardwareManager {
  constructor(store, options = {}) {
    this.store = store;
    this.options = options;
    this.isLinux = process.platform === "linux";
    this._thermalZonePath = null;
    this._backlightPath = null;
  }

  async init() {
    if (!this.isLinux) {
      if (process.env.NODE_ENV !== "test") {
        logger.info("HardwareManager: Non-Linux platform detected; running in simulation mode.");
      }
      return;
    }

    // Subscribe to store events (MirrorStore now extends EventEmitter)
    this.store.on("displayStateChanged", (state) => this.handleDisplayStateChange(state));
    this.store.on("displayModeChanged", (mode) => this.handleDisplayModeChange(mode));

    // Pre-discover backlight path
    await this._resolveBacklightPath().catch(() => {});

    logger.info("HardwareManager: Initialized and listening for store events.");
  }

  async handleDisplayStateChange(state) {
    logger.info(`HardwareManager: Display state changed to ${state}`);
    try {
      if (state === "off") {
        await this.setScreenPower(false);
      } else if (state === "on") {
        await this.setScreenPower(true);
      }
    } catch (error) {
      logger.error({ err: error }, `HardwareManager: Failed to change screen power: ${error.message}`);
    }
  }

  async handleDisplayModeChange(mode) {
    logger.info(`HardwareManager: Display mode changed to ${mode}`);
    // Future: handle specific hardware configs for different modes (e.g. brightness)
  }

  /**
   * Discover the first available backlight device path.
   * Priority: /sys/class/backlight/* > /sys/class/graphics/fb0/blank > xset
   */
  async _resolveBacklightPath() {
    try {
      const entries = await readdir(BACKLIGHT_BASE);
      if (entries.length > 0) {
        this._backlightPath = join(BACKLIGHT_BASE, entries[0], "brightness");
        this._backlightMaxPath = join(BACKLIGHT_BASE, entries[0], "max_brightness");
      }
    } catch {
      // No backlight class — will fall through to fb0 or xset
    }
  }

  async setScreenPower(on) {
    if (!this.isLinux) return;

    // 1st priority: /sys/class/backlight/<device>/brightness (works on most SBCs)
    if (this._backlightPath && this._backlightMaxPath) {
      try {
        if (on) {
          const max = (await readFile(this._backlightMaxPath, "utf8")).trim();
          await writeFile(this._backlightPath, max);
        } else {
          await writeFile(this._backlightPath, "0");
        }
        return;
      } catch (error) {
        logger.warn(`HardwareManager: Backlight sysfs failed: ${error.message}`);
      }
    }

    // 2nd priority: /sys/class/graphics/fb0/blank (framebuffer blank)
    try {
      await writeFile(FB_BLANK_PATH, on ? "0\n" : "1\n");
      return;
    } catch (fbError) {
      logger.warn(`HardwareManager: fb0 blank failed: ${fbError.message}`);
    }

    // 3rd priority: xset dpms (X11 only — requires $DISPLAY)
    try {
      const display = process.env.DISPLAY || ":0";
      const cmd = on ? `DISPLAY=${display} xset dpms force on` : `DISPLAY=${display} xset dpms force off`;
      await execAsync(cmd);
    } catch (xError) {
      throw new Error(`All screen power methods failed. Last error: ${xError.message}`);
    }
  }

  async getTemperature() {
    if (!this.isLinux) {
      // Simulated temperature for local testing on Windows/macOS
      return 42.5;
    }

    try {
      if (!this._thermalZonePath) {
        const zones = await readdir(THERMAL_BASE);
        for (const zone of zones) {
          if (zone.startsWith("thermal_zone")) {
            const type = await readFile(join(THERMAL_BASE, zone, "type"), "utf8");
            if (type.trim() === "cpu-thermal" || type.trim() === "cpu") {
              this._thermalZonePath = join(THERMAL_BASE, zone, "temp");
              break;
            }
          }
        }
        // Fallback to zone 0 if we couldn't find a specific cpu-thermal
        if (!this._thermalZonePath) {
          this._thermalZonePath = join(THERMAL_BASE, "thermal_zone0", "temp");
        }
      }

      const temp = await readFile(this._thermalZonePath, "utf8");
      return parseFloat(temp) / 1000; // Convert millidegrees to degrees
    } catch (error) {
      logger.error({ err: error }, `HardwareManager: Could not read temperature: ${error.message}`);
      return null;
    }
  }

  async setGpioValue(pin, value) {
    if (!this.isLinux) return;

    try {
      // Using gpiod (standard for Allwinner/Rockchip)
      // gpioset <chip> <offset>=<value>
      await execAsync(`gpioset gpiochip1 ${pin}=${value ? 1 : 0}`);
    } catch (error) {
      throw new Error(`GPIO error on pin ${pin}: ${error.message}`);
    }
  }

  async getGpioValue(pin) {
    if (!this.isLinux) return null;

    try {
      const { stdout } = await execAsync(`gpioget gpiochip1 ${pin}`);
      return stdout.trim() === "1";
    } catch (error) {
      throw new Error(`GPIO read error on pin ${pin}: ${error.message}`);
    }
  }
}

export function createHardwareManager(store) {
  return new HardwareManager(store);
}
