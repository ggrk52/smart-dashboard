import { logger } from "./logger.js";

const SERVICE_UUID = "e005085f-3665-4f36-b605-e3d162fdb0b7";
const CHARACTERISTIC_UUID = "e0050860-3665-4f36-b605-e3d162fdb0b7";

let bleno = null;

export async function startBleServer(onWifiReceived) {
  if (!bleno) {
    try {
      bleno = (await import("@abandonware/bleno")).default;
    } catch {
      logger.warn("BLE not available on this platform. Bluetooth setup mode will not work.");
      return false;
    }
  }

  class SetupCharacteristic extends bleno.Characteristic {
    constructor() {
      super({
        uuid: CHARACTERISTIC_UUID,
        properties: ["write", "writeWithoutResponse"],
        value: null,
      });
    }

    onWriteRequest(data, offset, withoutResponse, callback) {
      try {
        const payload = data.toString("utf8");
        logger.info("Received BLE write request");
        // Expecting format: SSID|PASSWORD
        const parts = payload.split("|");
        if (parts.length >= 2) {
          const ssid = parts[0];
          const password = parts.slice(1).join("|");
          onWifiReceived({ ssid, password }).catch(e => logger.error(e, "Error applying Wi-Fi from BLE"));
        } else {
          logger.warn("Invalid BLE payload format");
        }
        callback(this.RESULT_SUCCESS);
      } catch (error) {
        logger.error(error, "Error parsing BLE payload");
        callback(this.RESULT_UNLIKELY_ERROR);
      }
    }
  }

  const characteristic = new SetupCharacteristic();
  const service = new bleno.PrimaryService({
    uuid: SERVICE_UUID,
    characteristics: [characteristic],
  });

  bleno.on("stateChange", (state) => {
    logger.info({ state }, "BLE state changed");
    if (state === "poweredOn") {
      bleno.startAdvertising("MagicMirrorSetup", [SERVICE_UUID]);
    } else {
      bleno.stopAdvertising();
    }
  });

  bleno.on("advertisingStart", (error) => {
    if (error) {
      logger.error(error, "BLE advertising error");
    } else {
      logger.info("BLE advertising started");
      bleno.setServices([service]);
    }
  });

  if (bleno.state === "poweredOn") {
    bleno.startAdvertising("MagicMirrorSetup", [SERVICE_UUID]);
  }

  return true;
}

export function stopBleServer() {
  if (bleno) {
    bleno.stopAdvertising();
  }
}
