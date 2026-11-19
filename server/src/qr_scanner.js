import { logger } from "./logger.js";

const webcamOptions = {
    width: 640,
    height: 480,
    quality: 100,
    delay: 0,
    saveShots: false,
    output: "jpeg",
    device: false,
    callbackReturn: "buffer",
    verbose: false
};

let Webcam = null;
let createCanvas = null;
let loadImage = null;
let jsQR = null;

async function ensureDependencies() {
  if (!Webcam) {
    const nw = (await import("node-webcam")).default;
    const canv = await import("canvas");
    const jsqrMod = (await import("jsqr")).default;
    createCanvas = canv.createCanvas;
    loadImage = canv.loadImage;
    jsQR = jsqrMod;
    Webcam = nw.create(webcamOptions);
  }
}

function captureFrame() {
  return new Promise((resolve, reject) => {
    if (!Webcam) return reject(new Error("Webcam not initialized"));
    Webcam.capture("temp_qr_frame", (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

let scanningInterval = null;

export async function startQrScanner(onWifiReceived) {
  if (scanningInterval) return;

  try {
    await ensureDependencies();
  } catch (err) {
    logger.warn({ err }, "QR Scanner dependencies (canvas/node-webcam) not available; skipping QR scan.");
    return;
  }

  logger.info("Starting QR Code Scanner for Wi-Fi provisioning");

  scanningInterval = setInterval(async () => {
    try {
      const buffer = await captureFrame();
      if (!buffer) return;

      const img = await loadImage(buffer);
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, img.width, img.height);
      
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert",
      });

      if (code) {
        logger.info("QR Code found in camera frame!");
        const data = code.data;
        // Format WIFI:T:WPA;S:ssid;P:password;;
        if (data.startsWith("WIFI:")) {
          const matchSsid = data.match(/S:([^;]+);/);
          const matchPass = data.match(/P:([^;]+);/);
          if (matchSsid) {
            const ssid = matchSsid[1];
            const password = matchPass ? matchPass[1] : "";
            logger.info(`Parsed Wi-Fi: ${ssid}`);
            onWifiReceived({ ssid, password }).catch(e => logger.error(e, "QR Wi-Fi apply error"));
            // Stop scanning after successful read to avoid spam
            stopQrScanner();
          }
        }
      }
    } catch (error) {
      // Ignore normal camera capture errors to not spam logs
    }
  }, 2000);
}

export function stopQrScanner() {
  if (scanningInterval) {
    logger.info("Stopping QR Code Scanner");
    clearInterval(scanningInterval);
    scanningInterval = null;
  }
}
