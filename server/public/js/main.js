import { startDishesPolling } from "./components/dishes.js";
import { startClusterPolling } from "./components/cluster.js";
import { startImmichPolling } from "./components/immich.js";
import { initGamepad } from "./components/gamepad.js";
import { startClock } from "./components/clock.js";
import { startWeatherPolling, updateWeatherConfig } from "./components/weather.js";
import { startCalendarPolling, loadCalendarEvents } from "./components/calendar.js";
import { startMarketsPolling, renderMarkets, loadMarketsChart } from "./components/markets.js";
import { startNewsPolling, renderNews, rotateNewsHeadline } from "./components/news.js";
import { initWs } from "./services/ws.js";
import { initAr, startAr, stopAr, updateArConfig } from "./components/ar.js";

// DOM Elements
const mirrorRoot = document.querySelector("#mirrorRoot");
const photoScreen = document.querySelector("#photoScreen");
const photoImage = document.querySelector("#photoImage");
const photoTimer = document.querySelector("#photoTimer");
const photoImageB = document.querySelector("#photoImageB");
const galleryImage = document.querySelector("#galleryImage");
const galleryTitle = document.querySelector("#galleryTitle");
const galleryArtist = document.querySelector("#galleryArtist");
const connectionState = document.querySelector("#connectionState");
const mirrorMeta = document.querySelector("#mirrorMeta");
const pairingPanel = document.querySelector("#pairingPanel");
const pairingQr = document.querySelector("#pairingQr");
const pairingHint = document.querySelector("#pairingHint");
const displayBlackout = document.querySelector("#displayBlackout");
const toastContainer = document.querySelector("#toastContainer");
const timerWidget = document.querySelector("#timerWidget");
const timerTime = document.querySelector("#timerTime");
const timerLabel = document.querySelector("#timerLabel");
const timerProgressCircle = document.querySelector("#timerProgressCircle");
const noteWidget = document.querySelector("#noteWidget");
const noteSender = document.querySelector("#noteSender");
const noteText = document.querySelector("#noteText");

// Configurations
const wsToken = window.__MIRROR_CONFIG__?.wsToken ?? "";

// ── Toast Notifications ──────────────────────────────────────────────
let toastQueue = [];
let toastActive = false;

function showToast(text) {
  toastQueue.push(text);
  if (!toastActive) processToastQueue();
}

function processToastQueue() {
  if (!toastContainer || toastQueue.length === 0) {
    toastActive = false;
    return;
  }
  toastActive = true;
  const text = toastQueue.shift();

  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span class="toast-dot"></span>${text}`;
  toastContainer.appendChild(el);

  const hideDelay = 3200;
  const outDuration = 300;

  setTimeout(() => {
    el.classList.add("toast-out");
    setTimeout(() => {
      el.remove();
      setTimeout(processToastQueue, 80);
    }, outDuration);
  }, hideDelay);
}

// ── Accent (applied from server state via WebSocket) ─────────────────
let _prevDisplayMode = null;
let _prevMusicPlaying = false;
let _prevHasPhoto = false;
let _prevAccentColor = null;

function applyAccent({ color, dim, text } = {}) {
  if (!color) return;
  const root = document.documentElement;
  root.style.setProperty("--accent", color);
  root.style.setProperty("--accent-dim", dim ?? "rgba(255,255,255,0.16)");
  root.style.setProperty("--accent-text", text ?? "#000");
}

const artworks = [
  { title: "The Bedroom", artist: "Винсент ван Гог", file: "bedroom.jpg" },
  { title: "Self-Portrait", artist: "Винсент ван Гог", file: "self-portrait.jpg" },
  { title: "Water Lilies", artist: "Клод Моне", file: "water-lilies.jpg" },
  { title: "Arrival of the Normandy Train", artist: "Клод Моне", file: "normandy-train.jpg" },
  { title: "Two Sisters (On the Terrace)", artist: "Пьер-Огюст Ренуар", file: "two-sisters.jpg" },
  { title: "Woman at the Piano", artist: "Пьер-Огюст Ренуар", file: "woman-piano.jpg" },
  { title: "The Basket of Apples", artist: "Поль Сезанн", file: "basket-apples.jpg" },
  { title: "The Bay of Marseille", artist: "Поль Сезанн", file: "marseille-bay.jpg" },
];

let currentArtworkIndex = -1;
let currentPhonePhotoId = null;
let currentPhonePhotoExpiresAt = null;
let phonePhotoObjectUrlA = null;
let phonePhotoObjectUrlB = null;
let photoActiveSlot = "a";

// Module Fitting Logic
let moduleFitFrame = 0;
const pendingModuleFitIds = new Set();
const moduleWidthFit = {
  clock: { factor: 0.026, min: 10, max: 34 },
  weather: { factor: 0.024, min: 9, max: 28 },
  calendar: { factor: 0.026, min: 9, max: 24 },
  markets: { factor: 0.025, min: 9, max: 23 },
  news: { factor: 0.032, min: 10, max: 32 },
  music: { factor: 0.025, min: 10, max: 28 },
};

const moduleResizeObserver =
  "ResizeObserver" in window
    ? new ResizeObserver((entries) => {
        for (const entry of entries) {
          const moduleId = entry.target.dataset.moduleId;
          if (moduleId) {
            scheduleModuleFit(moduleId);
          }
        }
      })
    : null;

function fitModuleContent(element) {
  const content = element.querySelector(".module-content");
  const boxWidth = element.clientWidth;

  if (!content || boxWidth <= 0) {
    return;
  }

  const rule = moduleWidthFit[element.dataset.moduleId] ?? { factor: 0.026, min: 9, max: 26 };
  let size = Math.min(Math.max(boxWidth * rule.factor, rule.min), rule.max);
  setModuleFitSize(content, size);

  for (let index = 0; index < 6 && content.scrollWidth > boxWidth + 1; index += 1) {
    size = Math.max(rule.min, size * 0.9);
    setModuleFitSize(content, size);
  }
}

function setModuleFitSize(content, size) {
  const nextSize = `${size.toFixed(2)}px`;

  if (content.dataset.fitSize === nextSize) {
    return;
  }

  content.dataset.fitSize = nextSize;
  content.style.setProperty("--module-fit-size", nextSize);
}

function flushModuleFits() {
  moduleFitFrame = 0;

  for (const moduleId of pendingModuleFitIds) {
    const element = document.querySelector(`[data-module-id="${moduleId}"]`);
    if (element) {
      fitModuleContent(element);
    }
  }

  pendingModuleFitIds.clear();
}

function scheduleModuleFit(moduleId) {
  pendingModuleFitIds.add(moduleId);

  if (!moduleFitFrame) {
    moduleFitFrame = window.requestAnimationFrame(flushModuleFits);
  }
}

function scheduleAllModuleFits() {
  for (const element of document.querySelectorAll("[data-module-id]")) {
    scheduleModuleFit(element.dataset.moduleId);
  }
}

function observeModuleFrames() {
  if (!moduleResizeObserver) {
    return;
  }

  for (const element of document.querySelectorAll("[data-module-id]")) {
    moduleResizeObserver.observe(element);
  }
}

// Artwork Display — local offline gallery with crossfade
const galleryImageB = document.querySelector("#galleryImageB");
let galleryActiveSlot = "a";

function showRandomArtwork() {
  if (artworks.length === 0) {
    return;
  }

  let nextIndex = Math.floor(Math.random() * artworks.length);
  if (artworks.length > 1 && nextIndex === currentArtworkIndex) {
    nextIndex = (nextIndex + 1) % artworks.length;
  }

  currentArtworkIndex = nextIndex;
  const artwork = artworks[currentArtworkIndex];
  const src = `/gallery/${artwork.file}`;
  const alt = `${artwork.title}, ${artwork.artist}`;

  // Crossfade: load into the hidden slot, then swap
  if (galleryImageB) {
    const incoming = galleryActiveSlot === "a" ? galleryImageB : galleryImage;
    const outgoing = galleryActiveSlot === "a" ? galleryImage : galleryImageB;

    incoming.src = src;
    incoming.alt = alt;
    incoming.classList.add("gallery-img-active");
    outgoing.classList.remove("gallery-img-active");
    galleryActiveSlot = galleryActiveSlot === "a" ? "b" : "a";
  } else {
    galleryImage.src = src;
    galleryImage.alt = alt;
  }

  galleryTitle.textContent = artwork.title;
  galleryArtist.textContent = artwork.artist;
}

// Phone Photo Handling
function clearPhonePhoto() {
  currentPhonePhotoId = null;
  currentPhonePhotoExpiresAt = null;

  if (phonePhotoObjectUrlA) {
    URL.revokeObjectURL(phonePhotoObjectUrlA);
    phonePhotoObjectUrlA = null;
  }
  if (phonePhotoObjectUrlB) {
    URL.revokeObjectURL(phonePhotoObjectUrlB);
    phonePhotoObjectUrlB = null;
  }

  if (photoImage) {
    photoImage.removeAttribute("src");
    photoImage.classList.remove("photo-img-active");
  }
  if (photoImageB) {
    photoImageB.removeAttribute("src");
    photoImageB.classList.remove("photo-img-active");
  }
}

function formatPhotoRemaining(expiresAt) {
  const remainingSeconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));

  if (remainingSeconds >= 60) {
    const minutes = Math.ceil(remainingSeconds / 60);
    return `${minutes} мин`;
  }

  return `${remainingSeconds} сек`;
}

async function loadPhonePhoto(photoOverlay) {
  if (!photoOverlay || !photoImage || currentPhonePhotoId === photoOverlay.id) {
    return;
  }

  currentPhonePhotoId = photoOverlay.id;
  photoTimer.textContent = "загрузка";

  try {
    const response = await fetch(`/api/mirror/photo/current?id=${encodeURIComponent(photoOverlay.id)}`, {
      headers: {
        Authorization: `Bearer ${wsToken}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Photo request failed");
    }

    const objectUrl = URL.createObjectURL(await response.blob());
    
    if (photoImageB) {
      const incoming = photoActiveSlot === "a" ? photoImageB : photoImage;
      const outgoing = photoActiveSlot === "a" ? photoImage : photoImageB;
      const incomingUrlStore = photoActiveSlot === "a" ? "phonePhotoObjectUrlB" : "phonePhotoObjectUrlA";

      incoming.src = objectUrl;
      incoming.classList.add("photo-img-active");
      outgoing.classList.remove("photo-img-active");
      
      if (photoActiveSlot === "a") {
        if (phonePhotoObjectUrlB) URL.revokeObjectURL(phonePhotoObjectUrlB);
        phonePhotoObjectUrlB = objectUrl;
      } else {
        if (phonePhotoObjectUrlA) URL.revokeObjectURL(phonePhotoObjectUrlA);
        phonePhotoObjectUrlA = objectUrl;
      }

      photoActiveSlot = photoActiveSlot === "a" ? "b" : "a";
    } else {
      if (phonePhotoObjectUrlA) URL.revokeObjectURL(phonePhotoObjectUrlA);
      phonePhotoObjectUrlA = objectUrl;
      photoImage.src = objectUrl;
    }
  } catch (error) {
    clearPhonePhoto();
    if (photoTimer) {
      photoTimer.textContent = "фото недоступно";
    }
  }
}

let currentPhotoPlaylist = null;
let currentPhotoPlaylistIndex = 0;
let slideshowTimer = null;

function renderPhonePhoto(photoOverlayRaw) {
  const photoOverlayList = Array.isArray(photoOverlayRaw) ? photoOverlayRaw : (photoOverlayRaw ? [photoOverlayRaw] : null);
  const hasPhoto = Boolean(photoOverlayList && photoOverlayList.length > 0);
  mirrorRoot.classList.toggle("photo-mode", hasPhoto);

  if (!hasPhoto) {
    clearPhonePhoto();
    currentPhotoPlaylist = null;
    if (slideshowTimer) {
      clearInterval(slideshowTimer);
      slideshowTimer = null;
    }
    return;
  }

  const currentIds = currentPhotoPlaylist?.map(p => p.id).join(',') || "";
  const newIds = photoOverlayList.map(p => p.id).join(',');

  if (currentIds !== newIds) {
    currentPhotoPlaylist = photoOverlayList;
    currentPhotoPlaylistIndex = 0;
    
    if (slideshowTimer) {
      clearInterval(slideshowTimer);
      slideshowTimer = null;
    }
    
    if (photoOverlayList.length > 1) {
      slideshowTimer = setInterval(() => {
        currentPhotoPlaylistIndex = (currentPhotoPlaylistIndex + 1) % currentPhotoPlaylist.length;
        displayCurrentPhotoInPlaylist();
      }, 5000);
    }
    displayCurrentPhotoInPlaylist();
  }
}

function displayCurrentPhotoInPlaylist() {
  if (!currentPhotoPlaylist || currentPhotoPlaylist.length === 0) return;
  const currentPhoto = currentPhotoPlaylist[currentPhotoPlaylistIndex];
  
  if (photoTimer) {
    currentPhonePhotoExpiresAt = currentPhoto.expiresAt;
    photoTimer.textContent = formatPhotoRemaining(currentPhoto.expiresAt);
  }
  
  loadPhonePhoto(currentPhoto);
}

function formatMetaTime(value) {
  if (!value) {
    return "Без перезагрузок";
  }

  return `Перезагрузка ${new Intl.DateTimeFormat("ru-RU", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))}`;
}

// Rendering state changes
function setModuleVisibility(state) {
  const modulesById = new Map(state.modules.map((module) => [module.id, module]));

  for (const element of document.querySelectorAll("[data-module-id]")) {
    const module = modulesById.get(element.dataset.moduleId);
    element.classList.toggle("module-hidden", module?.visible === false);
  }
}

function renderMusic(music) {
  const titleEl = document.querySelector("#musicTitle");
  const artistEl = document.querySelector("#musicArtist");
  const artEl = document.querySelector("#musicArt");
  
  if (!titleEl || !artistEl || !artEl) return;
  
  if (music && music.isPlaying) {
    titleEl.textContent = music.title || "Неизвестный трек";
    artistEl.textContent = music.artist || "Неизвестный исполнитель";
    if (music.albumArt) {
      artEl.src = music.albumArt;
      artEl.hidden = false;
    } else {
      artEl.hidden = true;
    }
  } else {
    titleEl.textContent = "Нет музыки";
    artistEl.textContent = "";
    artEl.hidden = true;
  }
}

function setModuleLayout(state) {
  const modulesById = new Map(state.modules.map((module) => [module.id, module]));

  mirrorRoot.classList.toggle("layout-edit-mode", Boolean(state.layoutEditMode));

  for (const element of document.querySelectorAll("[data-module-id]")) {
    const module = modulesById.get(element.dataset.moduleId);
    const layout = module?.layout;

    if (!layout) {
      continue;
    }

    element.style.setProperty("--layout-x", layout.x);
    element.style.setProperty("--layout-y", layout.y);
    element.style.setProperty("--layout-w", layout.w);
    element.style.setProperty("--layout-h", layout.h);
    element.dataset.layoutLabel = module.title;
    element.classList.toggle("align-right", layout.x >= 48);
    element.classList.toggle("align-center", layout.w >= 70 || module.id === "news");
    scheduleModuleFit(module.id);
  }
}


// ── Night Mode (Pure CSS class on root, 0% CPU) ───────────────────────
let _nightModeConfig = null;

function isNightTime(startHour, endHour) {
  const currentHour = new Date().getHours();
  if (startHour === endHour) return false;
  if (startHour < endHour) {
    return currentHour >= startHour && currentHour < endHour;
  }
  return currentHour >= startHour || currentHour < endHour;
}

function renderNightMode(config) {
  _nightModeConfig = config;
  updateNightModeClass();
}

function updateNightModeClass() {
  if (!_nightModeConfig) return;
  const isNight =
    Boolean(_nightModeConfig.enabled) ||
    (Boolean(_nightModeConfig.auto) && isNightTime(_nightModeConfig.startHour, _nightModeConfig.endHour));
  mirrorRoot.classList.toggle("night-mode", isNight);
}

window.setInterval(updateNightModeClass, 60000);

// ── Interactive Timer Widget ──────────────────────────────────────────
let activeTimerInterval = null;
const TIMER_CIRCUMFERENCE = 314.16;

function renderTimer(timer) {
  if (activeTimerInterval) {
    clearInterval(activeTimerInterval);
    activeTimerInterval = null;
  }

  if (!timerWidget || !timer || !timer.active) {
    if (timerWidget) timerWidget.hidden = true;
    return;
  }

  const durationSeconds = timer.durationSeconds || 60;
  const endsAtMs = new Date(timer.endsAt).getTime();

  function updateTimerTick() {
    const now = Date.now();
    const remainingMs = Math.max(0, endsAtMs - now);
    const remainingSec = Math.ceil(remainingMs / 1000);

    const minutes = Math.floor(remainingSec / 60);
    const seconds = remainingSec % 60;
    if (timerTime) {
      timerTime.textContent = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
    if (timerLabel) {
      timerLabel.textContent = timer.label || "Таймер";
    }

    if (timerProgressCircle) {
      const fraction = Math.max(0, Math.min(1, remainingSec / durationSeconds));
      timerProgressCircle.style.strokeDashoffset = (TIMER_CIRCUMFERENCE * (1 - fraction)).toFixed(2);
    }

    if (remainingSec <= 0) {
      clearInterval(activeTimerInterval);
      activeTimerInterval = null;
      showToast(`⏱️ ${timer.label || "Таймер"} завершён!`);
      setTimeout(() => {
        if (!activeTimerInterval && timerWidget) {
          timerWidget.hidden = true;
        }
      }, 2000);
    }
  }

  timerWidget.hidden = false;
  updateTimerTick();
  activeTimerInterval = setInterval(updateTimerTick, 1000);
}

// ── Sticky Notes Widget ───────────────────────────────────────────────
function renderNote(note) {
  if (!noteWidget) return;

  if (!note || !note.text) {
    noteWidget.hidden = true;
    return;
  }

  if (note.expiresAt && new Date(note.expiresAt).getTime() <= Date.now()) {
    noteWidget.hidden = true;
    return;
  }

  if (noteSender) {
    noteSender.textContent = note.sender || "Заметка";
  }
  if (noteText) {
    noteText.textContent = note.text;
  }
  noteWidget.hidden = false;
}

function renderState(state) {
  const displayMode = state.displayMode ?? "mirror";
  const photoOverlay = state.photoOverlay ?? null;
  const displayOff = state.displayState === "off";

  const isArMode = displayMode === "ar" && !photoOverlay && !displayOff;

  mirrorRoot.classList.toggle("display-off", displayOff);
  document.documentElement.classList.toggle("display-off", displayOff);
  document.body.classList.toggle("display-off", displayOff);
  if (displayBlackout) {
    displayBlackout.hidden = !displayOff;
  }
  mirrorRoot.classList.toggle("gallery-mode", displayMode === "gallery");
  mirrorRoot.classList.toggle("ar-mode", isArMode);
  mirrorRoot.classList.toggle("orientation-horizontal", state.orientation === "horizontal");
  mirrorRoot.classList.toggle("orientation-vertical", state.orientation !== "horizontal");
  renderPhonePhoto(photoOverlay);
  setModuleLayout(state);
  setModuleVisibility(state);
  renderMusic(state.music);
  renderNightMode(state.nightMode);
  renderTimer(state.timer);
  renderNote(state.note);

  // ── Apply accent from server state ──
  if (state.accent && state.accent.color !== _prevAccentColor) {
    applyAccent(state.accent);
    _prevAccentColor = state.accent.color;
  }

  // ── Toast notifications on state changes ──
  const hasPhoto = Boolean(photoOverlay);
  const modeChanged = _prevDisplayMode !== null && _prevDisplayMode !== displayMode;
  const photoChanged = _prevHasPhoto !== hasPhoto;
  const musicChanged = Boolean(state.music?.isPlaying) !== _prevMusicPlaying;

  if (modeChanged && !hasPhoto) {
    const modeLabels = {
      mirror: "Режим: Зеркало",
      gallery: "Режим: Галерея",
      ar: "Режим: AR",
    };
    showToast(modeLabels[displayMode] ?? displayMode);
  }
  if (photoChanged && hasPhoto) showToast("Фото получено");
  if (photoChanged && !hasPhoto && _prevHasPhoto) showToast("Фото убрано");
  if (musicChanged && state.music?.isPlaying) showToast(`${state.music.title ? state.music.title.slice(0, 28) : "Музыка"}`);
  if (musicChanged && !state.music?.isPlaying && _prevMusicPlaying) showToast("Музыка остановлена");

  _prevDisplayMode = displayMode;
  _prevHasPhoto = hasPhoto;
  _prevMusicPlaying = Boolean(state.music?.isPlaying);
  // ───────────────────────────────────────────

  if (state.calendarUrls) {
    const calendarUrlsStr = JSON.stringify(state.calendarUrls);
    if (calendarUrlsStr !== window.__lastCalendarUrlsStr) {
      window.__lastCalendarUrlsStr = calendarUrlsStr;
      loadCalendarEvents(wsToken, () => scheduleModuleFit("calendar"));
    }
  }

  if (state.weatherConfig) {
    updateWeatherConfig(state.weatherConfig);
  }

  if (!photoOverlay && displayMode === "gallery" && currentArtworkIndex === -1) {
    showRandomArtwork();
  }

  if (isArMode) {
    startAr();
    if (state.arConfig) {
      updateArConfig(state.arConfig);
    }
  } else {
    stopAr();
  }

  const visibleCount = state.modules.filter((module) => module.visible).length;
  const modeLabel =
    photoOverlay
      ? "фото с телефона"
      : displayMode === "gallery"
      ? "экран ожидания"
      : displayMode === "ar"
      ? "сканирование HUD"
      : "зеркало";
  mirrorMeta.textContent = `${modeLabel} - видно модулей: ${visibleCount}/${state.modules.length} - ${formatMetaTime(
    state.lastReloadedAt,
  )}`;
}

function setConnection(label, connected = false) {
  connectionState.textContent = label;
  connectionState.classList.toggle("connected", connected);
}

function renderPairingStatus(status) {
  if (!pairingPanel || !wsToken) {
    return;
  }

  pairingPanel.hidden = Boolean(status?.controllerConnected);
}

async function loadPairingQr() {
  if (!wsToken || !pairingPanel || !pairingQr) {
    return;
  }

  try {
    const statusResponse = await fetch("/api/pairing/status", {
      headers: {
        Authorization: `Bearer ${wsToken}`,
      },
      cache: "no-store",
    });

    if (statusResponse.ok) {
      const status = await statusResponse.json();
      renderPairingStatus(status);

      if (status.controllerConnected) {
        return;
      }
    }

    pairingPanel.hidden = false;
    const response = await fetch("/api/pairing/qr.svg", { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`QR endpoint returned ${response.status}`);
    }

    pairingQr.classList.remove("error");
    pairingQr.innerHTML = await response.text();
    pairingHint.textContent = "Открой приложение и нажми «Сканировать QR»";
  } catch (error) {
    pairingQr.classList.add("error");
    pairingQr.textContent = "QR недоступен. Перезапусти сервер после обновления кода.";
    pairingHint.textContent = "После перезапуска обнови страницу зеркала.";
  }
}

// Initializations
pairingPanel.hidden = true;
loadPairingQr();
showRandomArtwork();
initAr(wsToken);

observeModuleFrames();
scheduleAllModuleFits();

window.addEventListener("resize", scheduleAllModuleFits);

window.setInterval(() => {
  if (currentPhonePhotoExpiresAt && photoTimer) {
    photoTimer.textContent = formatPhotoRemaining(currentPhonePhotoExpiresAt);
  }
}, 1000);

window.setInterval(() => {
  if (mirrorRoot.classList.contains("gallery-mode")) {
    showRandomArtwork();
  }
}, 45 * 1000);

// Start Polls & Component loops
startClock();
startWeatherPolling(() => scheduleModuleFit("weather"));
startCalendarPolling(wsToken, () => scheduleModuleFit("calendar"));
startMarketsPolling(wsToken, () => scheduleModuleFit("markets"));
startNewsPolling(wsToken, () => scheduleModuleFit("news"));

// Initialize WebSocket
initWs({
  wsToken,
  onStateChange: renderState,
  onPairingStatusChange: renderPairingStatus,
  onConnectionChange: setConnection,
  onChartCurrencyChange: (code) => {
    if (code) loadMarketsChart(wsToken, code);
  },
});

startDishesPolling();
startClusterPolling();
startImmichPolling();
initGamepad(showToast);
