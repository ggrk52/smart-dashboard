// Cybernetic AR HUD Component with real TensorFlow.js face detection

let animationFrameId = null;
let videoStream = null;
let wsToken = "";

// State
let isDemoMode = true;
let hasCameraAccess = false;
let arActive = false;

// TensorFlow Face Detector
let detector = null;
let isDetectorLoading = false;
let isDetecting = false;
let detectedKeypoints = null;
let lastFaceDetectedTime = 0;

// HUD phases: "search", "scan", "identified"
let hudPhase = "search"; 
let phaseTimer = 0;
let lockProgress = 0; // 0 to 100

// Target tracking coordinates (smooth interpolation)
let targetX = 0.5;
let targetY = 0.5;
let currentX = 0.5;
let currentY = 0.5;
let targetFaceSize = 0.26;
let currentFaceSize = 0.26;

// Heart rate animation variables
let heartRate = 72;
let ecgData = [];
let ecgIndex = 0;

// Forced config from Android
let forcedProfile = null;

// Profiles database for simulation
const profiles = [
  { name: "СОЗДАТЕЛЬ", mood: "АКТИВЕН / ЗАРЯЖЕН", threat: "0%", id: "ID: MM-9842", recommendation: "Обнаружена высокая фокусная активность. Пора сделать эспрессо." },
  { name: "РАЗРАБОТЧИК", mood: "СВЕРХ-КОНЦЕНТРАЦИЯ", threat: "0.01%", id: "ID: MM-0012", recommendation: "Режим кодинга активирован. Выпей воды и выпрями спину." },
  { name: "АНДРОИД-ГОСТЬ", mood: "НЕЙТРАЛЬНОЕ", threat: "2.5%", id: "ID: MM-4850", recommendation: "Доступ разрешен в гостевую зону. Приятного использования." }
];
let activeProfileIndex = 0;

// DOM Elements
let container, video, canvas, ctx, kicker, trackingText, messageBox, btnDemo, btnClose;

export function initAr(token) {
  wsToken = token;

  // Cache DOM
  container = document.querySelector("#arScreen");
  video = document.querySelector("#arVideo");
  canvas = document.querySelector("#arCanvas");
  kicker = document.querySelector("#arKicker");
  trackingText = document.querySelector("#arTracking");
  messageBox = document.querySelector("#arMessage");
  btnDemo = document.querySelector("#arBtnDemo");
  btnClose = document.querySelector("#arBtnClose");

  if (!container || !video || !canvas) return;

  ctx = canvas.getContext("2d");

  // Wire buttons
  btnDemo.addEventListener("click", () => {
    // Optimistically send toggle request to backend to sync with Android
    sendArConfigToServer(!isDemoMode, forcedProfile);
  });

  btnClose.addEventListener("click", async () => {
    await exitArMode();
  });

  // Handle Resize
  window.addEventListener("resize", resizeCanvas);
}

function resizeCanvas() {
  if (!canvas || !arActive) return;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

async function exitArMode() {
  try {
    const response = await fetch("/api/mirror/mode", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${wsToken}`,
      },
      body: JSON.stringify({ mode: "mirror" }),
    });
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
  } catch (err) {
    console.error("Failed to exit AR mode via API:", err);
    document.querySelector("#mirrorRoot")?.classList.remove("ar-mode");
    stopAr();
  }
}

async function sendArConfigToServer(demoMode, forcedProf) {
  try {
    await fetch("/api/mirror/ar/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${wsToken}`,
      },
      body: JSON.stringify({ demoMode, forcedProfile: forcedProf }),
    });
  } catch (err) {
    console.error("Failed to sync AR config with server:", err);
    // Local fallback toggle
    toggleMode(demoMode);
  }
}

export function updateArConfig(config) {
  if (!config) return;

  if (config.demoMode !== undefined && config.demoMode !== isDemoMode) {
    toggleMode(config.demoMode);
  }

  if (config.forcedProfile !== undefined && config.forcedProfile !== forcedProfile) {
    forcedProfile = config.forcedProfile;
    if (forcedProfile) {
      const idx = profiles.findIndex(p => p.name === forcedProfile);
      if (idx !== -1) {
        activeProfileIndex = idx;
        if (hudPhase === "identified") {
          phaseTimer = 0; // lock profile timer
        }
      }
    }
  }
}

export async function startAr() {
  if (arActive) return;
  arActive = true;
  resizeCanvas();

  // Reset State
  hudPhase = "search";
  lockProgress = 0;
  phaseTimer = 0;
  detectedKeypoints = null;
  lastFaceDetectedTime = 0;
  activeProfileIndex = Math.floor(Math.random() * profiles.length);

  // Initialize ECG line
  ecgData = Array(120).fill(60);

  // Start video stream automatically if needed
  await startCameraStream();

  // Start AI detection background loop
  detectionLoop();

  // Start 60fps UI drawing loop
  tick();
}

export function stopAr() {
  if (!arActive) return;
  arActive = false;

  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  stopCameraStream();
}

async function startCameraStream() {
  if (isDemoMode) {
    video.srcObject = null;
    if (messageBox) messageBox.textContent = "";
    return;
  }

  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: "user" },
      audio: false
    });
    video.srcObject = videoStream;
    hasCameraAccess = true;
    btnDemo.classList.remove("active");
    btnDemo.textContent = "КАМЕРА: ВКЛ";
    
    // Load face detector if camera mode is turned on
    if (!detector) {
      await loadDetector();
    }
  } catch (err) {
    console.warn("Camera access denied or unavailable, switching to Demo Mode:", err);
    hasCameraAccess = false;
    sendArConfigToServer(true, forcedProfile);
  }
}

function stopCameraStream() {
  if (videoStream) {
    videoStream.getTracks().forEach(track => track.stop());
    videoStream = null;
  }
  video.srcObject = null;
}

function toggleMode(demo) {
  isDemoMode = demo;
  hudPhase = "search";
  lockProgress = 0;
  phaseTimer = 0;
  detectedKeypoints = null;
  
  if (isDemoMode) {
    stopCameraStream();
    btnDemo.classList.add("active");
    btnDemo.textContent = "ДЕМО-РЕЖИМ";
    if (messageBox) messageBox.textContent = "";
  } else {
    startCameraStream();
  }
}

async function loadTensorFlowScripts() {
  if (typeof faceDetection !== "undefined") return;
  const scripts = [
    "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@4.17.0",
    "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-converter@4.17.0",
    "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgl@4.17.0",
    "https://cdn.jsdelivr.net/npm/@tensorflow-models/face-detection@1.0.2",
  ];
  for (const src of scripts) {
    if (document.querySelector(`script[src="${src}"]`)) continue;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.crossOrigin = "anonymous";
      const timer = setTimeout(() => {
        s.onerror = null;
        s.onload = null;
        reject(new Error(`Timeout loading script: ${src}`));
      }, 7000);
      s.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      s.onerror = (err) => {
        clearTimeout(timer);
        reject(err);
      };
      document.head.appendChild(s);
    });
  }
}

async function loadDetector() {
  if (detector || isDetectorLoading) return;
  isDetectorLoading = true;
  if (messageBox) messageBox.textContent = "ЗАГРУЗКА ИИ-МОДЕЛИ ДЛЯ ДЕТЕКЦИИ ЛИЦ...";

  try {
    // Dynamically load scripts on demand with fail-safe timeout
    await loadTensorFlowScripts();

    // Initialize TFJS webgl backend for maximum performance
    if (typeof tf !== "undefined" && tf.setBackend) {
      await tf.setBackend("webgl");
    }

    const model = faceDetection.SupportedModels.MediaPipeFaceDetector;
    const detectorConfig = {
      runtime: 'tfjs',
      maxFaces: 1
    };
    detector = await faceDetection.createDetector(model, detectorConfig);
    console.log("MediaPipe Face detector loaded successfully!");
    if (messageBox) messageBox.textContent = "";
  } catch (err) {
    console.warn("Face Detector unavailable (offline or CDN blocked); using autonomous demo mode:", err.message);
    if (messageBox) {
      messageBox.textContent = "АВТОНОМНЫЙ ДЕМО-РЕЖИМ (ОФЛАЙН)";
      setTimeout(() => { if (messageBox && arActive) messageBox.textContent = ""; }, 2500);
    }
    // Force demo mode on failure
    sendArConfigToServer(true, forcedProfile);
  } finally {
    isDetectorLoading = false;
  }
}

// Background async loop for neural network inference
// Keeps canvas animation run at 60fps independently of TFJS frame processing time
async function detectionLoop() {
  if (!arActive) return;

  if (!isDemoMode && detector && videoStream && !video.paused && !video.ended && !isDetecting) {
    isDetecting = true;
    try {
      await runFaceDetection();
    } catch (e) {
      console.error("Inference error:", e);
    }
    isDetecting = false;
  }

  // Schedule next inference in 100ms (~10fps detection rate)
  // Keeps Orange Pi Allwinner SoC / Mali GPU cool while canvas renders at smooth 60fps via lerp
  setTimeout(detectionLoop, 100);
}

async function runFaceDetection() {
  const faces = await detector.estimateFaces(video, { flipHorizontal: false });

  if (faces.length > 0) {
    const face = faces[0];
    const box = face.box;
    const vWidth = video.videoWidth || 1280;
    const vHeight = video.videoHeight || 720;

    // Center coordinates
    const cx = box.xMin + box.width / 2;
    const cy = box.yMin + box.height / 2;

    // Translate coordinates to screen (mirror horizontally)
    targetX = 1.0 - (cx / vWidth);
    targetY = cy / vHeight;

    // Scale face box size dynamically
    targetFaceSize = (box.width / vWidth) * 0.9;

    // Store keypoints (6 points: right eye, left eye, nose tip, mouth, right ear, left ear)
    detectedKeypoints = face.keypoints.map(kp => ({
      x: 1.0 - (kp.x / vWidth),
      y: kp.y / vHeight
    }));

    lastFaceDetectedTime = Date.now();
  }
}

function updateHUDState() {
  phaseTimer++;

  // Smooth LERP current tracking brackets to target
  currentX += (targetX - currentX) * 0.12;
  currentY += (targetY - currentY) * 0.12;
  currentFaceSize += (targetFaceSize - currentFaceSize) * 0.1;

  // Determine if face is currently detected (or recently detected in camera mode)
  let isFacePresent = false;
  if (isDemoMode) {
    isFacePresent = true; // Always present in demo mode
  } else {
    // Camera mode: Face detected in last 800ms
    isFacePresent = (Date.now() - lastFaceDetectedTime) < 800;
  }

  if (isDemoMode) {
    // Demo mode float trajectory
    const t = Date.now() * 0.0012;
    targetX = 0.5 + Math.sin(t) * 0.22 + Math.cos(t * 0.7) * 0.04;
    targetY = 0.42 + Math.cos(t * 1.1) * 0.1 + Math.sin(t * 0.5) * 0.03;
    targetFaceSize = 0.26;
  }

  // Phase transitions
  if (!isFacePresent) {
    hudPhase = "search";
    phaseTimer = 0;
    lockProgress = 0;
    detectedKeypoints = null;
    kicker.textContent = "ПОИСК ОБЪЕКТА...";
    trackingText.textContent = "Сканирование пространства...";
    kicker.style.color = "var(--mustard-soft)";
  } else {
    if (hudPhase === "search") {
      kicker.textContent = "ОБЪЕКТ ОБНАРУЖЕН";
      trackingText.textContent = "Фиксация координат...";
      kicker.style.color = "#ffb600";

      if (phaseTimer > 40) {
        hudPhase = "scan";
        phaseTimer = 0;
        lockProgress = 0;
      }
    } else if (hudPhase === "scan") {
      kicker.textContent = "ИНИЦИАЛИЗАЦИЯ БИОМЕТРИИ";
      kicker.style.color = "#ffb600";

      lockProgress = Math.min(100, lockProgress + 2.0);
      trackingText.textContent = `Считывание сигнатуры лица... ${Math.floor(lockProgress)}%`;

      if (lockProgress >= 100) {
        hudPhase = "identified";
        phaseTimer = 0;
      }
    } else if (hudPhase === "identified") {
      kicker.textContent = "ИДЕНТИФИКАЦИЯ УСПЕШНА";
      kicker.style.color = "#00ff66";
      
      const profile = profiles[activeProfileIndex];
      trackingText.innerHTML = `${profile.name}<br>${profile.id}<br>НАСТРОЕНИЕ: ${profile.mood}<br>${profile.recommendation}`;

      // Profile rotation only if profile is not forced by Android controller
      if (!forcedProfile && phaseTimer > 400) {
        hudPhase = "search";
        phaseTimer = 0;
        activeProfileIndex = (activeProfileIndex + 1) % profiles.length;
      }
    }
  }

  // Update heart rate organically
  if (Math.random() < 0.05) {
    heartRate = Math.floor(66 + Math.sin(Date.now() * 0.001) * 4 + Math.random() * 2);
  }

  updateECG();
}

function updateECG() {
  ecgIndex++;
  let value = 60; // baseline

  const beatInterval = Math.max(30, Math.floor((60 / heartRate) * 60));
  const pos = ecgIndex % beatInterval;

  if (pos === 0) {
    value = 54;
  } else if (pos === 2) {
    value = 60;
  } else if (pos === 5) {
    value = 65;
  } else if (pos === 7) {
    value = 20; // R spike
  } else if (pos === 9) {
    value = 85; // S drop
  } else if (pos === 12) {
    value = 45; // T wave
  } else if (pos === 16) {
    value = 60;
  }

  ecgData.shift();
  ecgData.push(value);
}

function tick() {
  if (!arActive) return;

  updateHUDState();
  renderCanvas();

  animationFrameId = requestAnimationFrame(tick);
}

function renderCanvas() {
  const w = canvas.width / window.devicePixelRatio;
  const h = canvas.height / window.devicePixelRatio;

  ctx.clearRect(0, 0, w, h);

  const px = currentX * w;
  const py = currentY * h;

  // Use dynamic face size from TFJS model or float orbit
  const faceSize = h * currentFaceSize;

  // Outer glow shadow
  ctx.shadowBlur = 12;

  // 1. Draw Target Brackets
  let themeColor = "#00f3ff"; // cyan default
  if (hudPhase === "scan") themeColor = "#ffb600"; // amber
  if (hudPhase === "identified") themeColor = "#00ff66"; // neon green

  ctx.strokeStyle = themeColor;
  ctx.shadowColor = themeColor;
  ctx.lineWidth = 1.5;

  const hs = faceSize / 2;
  const len = hs * 0.3; // corner length

  // Top Left
  ctx.beginPath();
  ctx.moveTo(px - hs, py - hs + len);
  ctx.lineTo(px - hs, py - hs);
  ctx.lineTo(px - hs + len, py - hs);
  ctx.stroke();

  // Top Right
  ctx.beginPath();
  ctx.moveTo(px + hs, py - hs + len);
  ctx.lineTo(px + hs, py - hs);
  ctx.lineTo(px + hs - len, py - hs);
  ctx.stroke();

  // Bottom Left
  ctx.beginPath();
  ctx.moveTo(px - hs, py + hs - len);
  ctx.lineTo(px - hs, py + hs);
  ctx.lineTo(px - hs + len, py + hs);
  ctx.stroke();

  // Bottom Right
  ctx.beginPath();
  ctx.moveTo(px + hs, py + hs - len);
  ctx.lineTo(px + hs, py + hs);
  ctx.lineTo(px + hs - len, py + hs);
  ctx.stroke();

  // 2. Center scanning reticle
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.setLineDash([6, 12]);
  ctx.arc(px, py, hs * 1.25, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Rotating outer ring
  ctx.beginPath();
  const rotationAngle = (Date.now() * 0.001) % (Math.PI * 2);
  ctx.arc(px, py, hs * 1.35, rotationAngle, rotationAngle + Math.PI * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px, py, hs * 1.35, rotationAngle + Math.PI, rotationAngle + Math.PI + Math.PI * 0.6);
  ctx.stroke();

  // Inner crosshair dots
  ctx.fillStyle = themeColor;
  ctx.beginPath();
  ctx.arc(px, py, 3, 0, Math.PI * 2);
  ctx.fill();

  // 3. Cybernetic Face Landmark Points
  ctx.shadowBlur = 4;
  ctx.fillStyle = `${themeColor}cc`;
  ctx.strokeStyle = `${themeColor}22`;
  ctx.lineWidth = 0.5;

  if (isDemoMode && hudPhase !== "search") {
    // Demo simulated mesh
    const facePoints = [
      { x: px - hs * 0.35, y: py - hs * 0.25 },
      { x: px + hs * 0.35, y: py - hs * 0.25 },
      { x: px, y: py - hs * 0.1 },
      { x: px, y: py + hs * 0.08 },
      { x: px - hs * 0.6, y: py + hs * 0.1 },
      { x: px + hs * 0.6, y: py + hs * 0.1 },
      { x: px - hs * 0.25, y: py + hs * 0.38 },
      { x: px + hs * 0.25, y: py + hs * 0.38 },
      { x: px, y: py + hs * 0.7 }
    ];

    facePoints.forEach(pt => {
      pt.x += Math.sin(Date.now() * 0.02 + pt.y) * 1.5;
      pt.y += Math.cos(Date.now() * 0.02 + pt.x) * 1.5;
    });

    drawFaceMesh(facePoints);
  } else if (!isDemoMode && detectedKeypoints && detectedKeypoints.length > 0) {
    // REAL face recognition landmarks from TensorFlow model
    const facePoints = detectedKeypoints.map(kp => ({
      x: kp.x * w,
      y: kp.y * h
    }));

    // Draw real points
    facePoints.forEach(pt => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw connections between real keypoints (Eyes -> Nose -> Mouth)
    if (facePoints.length >= 4) {
      ctx.beginPath();
      ctx.moveTo(facePoints[0].x, facePoints[0].y); // left eye
      ctx.lineTo(facePoints[2].x, facePoints[2].y); // nose tip
      ctx.lineTo(facePoints[1].x, facePoints[1].y); // right eye
      ctx.moveTo(facePoints[2].x, facePoints[2].y);
      ctx.lineTo(facePoints[3].x, facePoints[3].y); // mouth center
      ctx.stroke();
    }
  }

  // 4. Sweeping laser scanning bar
  ctx.shadowBlur = 12;
  const scanY = py - hs + ((Math.sin(Date.now() * 0.003) + 1) / 2) * (faceSize);
  const grad = ctx.createLinearGradient(px - hs * 1.1, scanY, px + hs * 1.1, scanY);
  grad.addColorStop(0, `${themeColor}00`);
  grad.addColorStop(0.2, themeColor);
  grad.addColorStop(0.8, themeColor);
  grad.addColorStop(1, `${themeColor}00`);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(px - hs * 1.1, scanY);
  ctx.lineTo(px + hs * 1.1, scanY);
  ctx.stroke();

  // 5. Target Info Overlay Card
  ctx.shadowBlur = 6;
  ctx.fillStyle = themeColor;
  ctx.font = "10px var(--font-ui), monospace";
  ctx.textAlign = "left";

  const textX = px + hs + 15;
  let textY = py - hs + 12;

  ctx.fillText("DIST: 0.85M", textX, textY);
  textY += 14;
  ctx.fillText(`HR: ${heartRate} BPM`, textX, textY);
  textY += 14;

  if (hudPhase === "search") {
    ctx.fillStyle = "#ff2255";
    ctx.fillText("STATUS: SCANNING...", textX, textY);
  } else if (hudPhase === "scan") {
    ctx.fillStyle = "#ffb600";
    ctx.fillText(`LOCK: ${Math.floor(lockProgress)}%`, textX, textY);
  } else if (hudPhase === "identified") {
    ctx.fillStyle = "#00ff66";
    ctx.fillText("MATCH: 99.8%", textX, textY);
    textY += 14;
    ctx.fillText(profiles[activeProfileIndex].id, textX, textY);
  }

  // 6. Draw Pulse ECG Graph
  ctx.shadowBlur = 8;
  ctx.strokeStyle = themeColor;
  ctx.shadowColor = themeColor;
  ctx.lineWidth = 1.2;

  const gw = 180;
  const gh = 60;
  const gx = w - gw - 24;
  const gy = h - gh - 32;

  // Draw Grid
  ctx.strokeStyle = `${themeColor}22`;
  ctx.strokeRect(gx, gy, gw, gh);
  ctx.beginPath();
  for (let offset = 10; offset < gw; offset += 15) {
    ctx.moveTo(gx + offset, gy);
    ctx.lineTo(gx + offset, gy + gh);
  }
  for (let offset = 10; offset < gh; offset += 15) {
    ctx.moveTo(gx, gy + offset);
    ctx.lineTo(gx + gw, gy + offset);
  }
  ctx.stroke();

  // Draw ECG waveform
  ctx.strokeStyle = themeColor;
  ctx.beginPath();
  const step = gw / ecgData.length;
  for (let i = 0; i < ecgData.length; i++) {
    const valY = gy + (ecgData[i] / 100) * gh;
    if (i === 0) {
      ctx.moveTo(gx, valY);
    } else {
      ctx.lineTo(gx + i * step, valY);
    }
  }
  ctx.stroke();

  // Pulse Label
  ctx.fillStyle = themeColor;
  ctx.font = "8px var(--font-ui), monospace";
  ctx.fillText(`PULSE RATE: ${heartRate} BPM`, gx, gy - 6);
}

function drawFaceMesh(facePoints) {
  ctx.beginPath();
  ctx.moveTo(facePoints[0].x, facePoints[0].y);
  ctx.lineTo(facePoints[2].x, facePoints[2].y);
  ctx.lineTo(facePoints[1].x, facePoints[1].y);
  ctx.lineTo(facePoints[3].x, facePoints[3].y);
  ctx.lineTo(facePoints[8].x, facePoints[8].y);
  ctx.moveTo(facePoints[0].x, facePoints[0].y);
  ctx.lineTo(facePoints[4].x, facePoints[4].y);
  ctx.lineTo(facePoints[8].x, facePoints[8].y);
  ctx.moveTo(facePoints[1].x, facePoints[1].y);
  ctx.lineTo(facePoints[5].x, facePoints[5].y);
  ctx.lineTo(facePoints[8].x, facePoints[8].y);
  ctx.moveTo(facePoints[4].x, facePoints[4].y);
  ctx.lineTo(facePoints[6].x, facePoints[6].y);
  ctx.lineTo(facePoints[7].x, facePoints[7].y);
  ctx.lineTo(facePoints[5].x, facePoints[5].y);
  ctx.lineTo(facePoints[3].x, facePoints[3].y);
  ctx.lineTo(facePoints[6].x, facePoints[6].y);
  ctx.stroke();

  facePoints.forEach(pt => {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
}
