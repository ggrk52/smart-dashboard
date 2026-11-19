import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { dirname } from "node:path";
import defaultModules from "../config/defaultModules.json" with { type: "json" };
import {
  defaultModuleLayout,
  layoutMapFromModules,
  safeModuleLayout,
  validateModulePosition,
} from "./layout.js";
import { logger } from "./logger.js";

function nowIso() {
  return new Date().toISOString();
}

function photoMeta(photoOverlay) {
  if (!photoOverlay) {
    return null;
  }

  const photosList = Array.isArray(photoOverlay) ? photoOverlay : [photoOverlay];
  if (photosList.length === 0) {
    return null;
  }
  if (photosList.length === 1) {
    return photoMetaSingle(photosList[0]);
  }
  return photosList.map(photoMetaSingle);
}

function photoMetaSingle(photo) {
  return {
    id: photo.id,
    mimeType: photo.mimeType,
    sizeBytes: photo.data.length,
    uploadedAt: photo.uploadedAt,
    expiresAt: photo.expiresAt,
    durationSeconds: photo.durationSeconds,
  };
}

function cloneLayout(layout) {
  return {
    x: layout.x,
    y: layout.y,
    w: layout.w,
    h: layout.h,
  };
}

function cloneModule(module, initialLayout) {
  return {
    id: module.id,
    title: module.title,
    visible: Boolean(module.visible),
    refreshable: Boolean(module.refreshable),
    lastUpdatedAt: module.lastUpdatedAt ?? nowIso(),
    layout: safeModuleLayout(module.id, initialLayout?.[module.id]),
  };
}

export class MirrorStore extends EventEmitter {
  constructor(initialModules = defaultModules, { initialLayout = {}, initialState = {}, layoutStorage = null, stateStorage = null } = {}) {
    super();
    this.displayState = "on";
    this.displayMode = initialState.displayMode ?? "mirror";
    this.layoutEditMode = false;
    this.lastReloadedAt = null;
    this.orientation = initialState.orientation ?? "vertical";
    
    // Apply initial visibility
    const initialVisibility = initialState.modulesVisibility ?? {};
    this.modules = initialModules.map((module) => {
      const cloned = cloneModule(module, initialLayout);
      if (initialVisibility[cloned.id] !== undefined) {
        cloned.visible = Boolean(initialVisibility[cloned.id]);
      }
      return cloned;
    });

    this.photoOverlay = null;
    this.music = null;
    this.arConfig = initialState.arConfig ?? {
      demoMode: true,
      forcedProfile: null
    };
    this.weatherConfig = initialState.weatherConfig ?? {
      cityName: "Москва",
      latitude: "55.7558",
      longitude: "37.6173",
      timezone: "Europe/Moscow"
    };
    this.calendarUrls = initialState.calendarUrls ?? [];
    this.screenSchedule = initialState.screenSchedule ?? {
      enabled: false,
      days: [0, 1, 2, 3, 4, 5, 6],
      onTime: "08:00",
      offTime: "22:00"
    };
    this.accent = initialState.accent ?? {
      color: "rgba(255, 255, 255, 0.9)",
      dim: "rgba(255, 255, 255, 0.16)",
      text: "#000"
    };
    this.nightMode = initialState.nightMode ?? {
      enabled: false,
      auto: false,
      startHour: 23,
      endHour: 7,
    };
    this.timer = null;
    this.note = null;
    this.layoutStorage = layoutStorage;
    this.stateStorage = stateStorage;
  }

  async saveState() {
    if (this.stateStorage) {
      const stateToSave = {
        displayState: this.displayState,
        displayMode: this.displayMode,
        modulesVisibility: Object.fromEntries(this.modules.map(m => [m.id, m.visible])),
        arConfig: this.arConfig,
        weatherConfig: this.weatherConfig,
        calendarUrls: this.calendarUrls,
        screenSchedule: this.screenSchedule,
        orientation: this.orientation,
        accent: this.accent,
        nightMode: this.nightMode,
      };
      await this.stateStorage.save(stateToSave).catch(e => logger.error({ err: e }, "Failed to save state"));
    }
  }

  getState() {
    return {
      displayState: this.displayState,
      displayMode: this.displayMode,
      layoutEditMode: this.layoutEditMode,
      lastReloadedAt: this.lastReloadedAt,
      photoOverlay: photoMeta(this.photoOverlay),
      music: this.music,
      arConfig: this.arConfig,
      weatherConfig: this.weatherConfig,
      calendarUrls: this.calendarUrls,
      screenSchedule: this.screenSchedule,
      orientation: this.orientation,
      accent: this.accent,
      nightMode: this.nightMode,
      timer: this.timer,
      note: this.note,
      modules: this.modules.map((module) => ({
        ...module,
        layout: cloneLayout(module.layout),
      })),
    };
  }

  setAccent(config) {
    if (!config || typeof config !== "object") throw new Error("INVALID_ACCENT");
    const color = typeof config.color === "string" ? config.color.trim() : null;
    if (!color) throw new Error("INVALID_ACCENT");
    this.accent = {
      color,
      dim: typeof config.dim === "string" ? config.dim.trim() : "rgba(255,255,255,0.16)",
      text: typeof config.text === "string" ? config.text.trim() : "#000",
    };
    this.saveState();
    return this.getState();
  }

  setArConfig(config) {
    if (config && typeof config === "object") {
      this.arConfig = {
        demoMode: config.demoMode !== undefined ? Boolean(config.demoMode) : this.arConfig.demoMode,
        forcedProfile: config.forcedProfile !== undefined ? config.forcedProfile : this.arConfig.forcedProfile
      };
      this.saveState();
    }
    return this.getState();
  }

  setWeatherConfig(config) {
    if (config && typeof config === "object") {
      this.weatherConfig = {
        cityName: String(config.cityName ?? this.weatherConfig.cityName).trim(),
        latitude: String(config.latitude ?? this.weatherConfig.latitude).trim(),
        longitude: String(config.longitude ?? this.weatherConfig.longitude).trim(),
        timezone: String(config.timezone ?? this.weatherConfig.timezone).trim()
      };
      this.saveState();
    }
    return this.getState();
  }

  setCalendarUrls(urls) {
    if (Array.isArray(urls)) {
      this.calendarUrls = urls.map(url => String(url).trim()).filter(Boolean);
      this.saveState();
    }
    return this.getState();
  }

  setScreenSchedule(config) {
    if (config && typeof config === "object") {
      this.screenSchedule = {
        enabled: Boolean(config.enabled),
        days: Array.isArray(config.days) ? config.days.map(Number).filter(n => n >= 0 && n <= 6) : [0, 1, 2, 3, 4, 5, 6],
        onTime: String(config.onTime ?? "08:00").trim(),
        offTime: String(config.offTime ?? "22:00").trim()
      };
      this.saveState();
    }
    return this.getState();
  }

  setOrientation(orientation) {
    if (orientation !== "vertical" && orientation !== "horizontal") {
      throw new Error("INVALID_ORIENTATION");
    }
    this.orientation = orientation;
    this.saveState();
    return this.getState();
  }

  getModule(moduleId) {
    return this.modules.find((module) => module.id === moduleId) ?? null;
  }

  setDisplayAction(action) {
    if (!["on", "off", "reload"].includes(action)) {
      throw new Error("INVALID_DISPLAY_ACTION");
    }

    if (action === "reload") {
      this.lastReloadedAt = nowIso();
      return this.getState();
    }

    this.displayState = action;
    this.emit("displayStateChanged", action);
    this.saveState();
    return this.getState();
  }

  setDisplayState(state) {
    if (state !== "on" && state !== "off") {
      throw new Error("INVALID_DISPLAY_STATE");
    }
    this.displayState = state;
    this.emit("displayStateChanged", state);
    this.saveState();
    return this.getState();
  }

  setDisplayMode(mode) {
    if (mode !== "mirror" && mode !== "gallery" && mode !== "ar") {
      throw new Error("INVALID_DISPLAY_MODE");
    }

    this.photoOverlay = null;
    this.displayMode = mode;
    this.emit("displayModeChanged", mode);
    this.saveState();
    return this.getState();
  }

  setLayoutEditMode(active) {
    if (typeof active !== "boolean") {
      throw new Error("INVALID_LAYOUT_EDIT_MODE");
    }

    this.layoutEditMode = active;
    return this.getState();
  }

  async saveLayout() {
    if (!this.layoutStorage) {
      return;
    }

    await this.layoutStorage.save(layoutMapFromModules(this.modules));
  }

  async setModuleLayout(updates) {
    if (!Array.isArray(updates)) {
      throw new Error("INVALID_LAYOUT");
    }

    const nextLayouts = new Map();

    for (const update of updates) {
      const module = this.getModule(update?.id);
      if (!module) {
        throw new Error("MODULE_NOT_FOUND");
      }

      nextLayouts.set(
        module.id,
        validateModulePosition(module.id, update, module.layout),
      );
    }

    for (const [moduleId, layout] of nextLayouts) {
      this.getModule(moduleId).layout = layout;
    }

    await this.saveLayout();
    return this.getState();
  }

  async resetModuleLayout() {
    for (const module of this.modules) {
      module.layout = defaultModuleLayout(module.id);
    }

    await this.saveLayout();
    return this.getState();
  }

  setPhotoOverlay(photos) {
    const photosList = Array.isArray(photos) ? photos : [photos];
    if (photosList.length === 0) return this.getState();

    const uploadedAt = new Date();
    const durationSeconds = photosList[0].durationSeconds;
    const expiresAt = new Date(uploadedAt.getTime() + durationSeconds * 1000);

    this.displayState = "on";
    this.displayMode = "mirror";
    this.photoOverlay = photosList.map(p => ({
      id: `${uploadedAt.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      data: p.data,
      mimeType: p.mimeType,
      uploadedAt: uploadedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      durationSeconds: durationSeconds,
    }));

    return this.getState();
  }

  getPhotoOverlay(id) {
    if (!this.photoOverlay) {
      return null;
    }

    const photosList = this.photoOverlay;
    const target = id ? photosList.find((p) => p.id === id) : photosList[0];

    if (!target) return null;

    return {
      ...photoMetaSingle(target),
      data: target.data,
    };
  }

  clearPhotoOverlay() {
    this.photoOverlay = null;
    return this.getState();
  }

  clearExpiredPhotoOverlay(now = Date.now()) {
    if (!this.photoOverlay) {
      return false;
    }

    const photosList = this.photoOverlay;
    if (photosList.length === 0) {
      this.photoOverlay = null;
      return true;
    }

    if (new Date(photosList[0].expiresAt).getTime() > now) {
      return false;
    }

    this.photoOverlay = null;
    return true;
  }

  setModuleVisibility(moduleId, visible) {
    const module = this.getModule(moduleId);

    if (!module) {
      throw new Error("MODULE_NOT_FOUND");
    }

    if (typeof visible !== "boolean") {
      throw new Error("INVALID_VISIBILITY");
    }

    module.visible = visible;
    module.lastUpdatedAt = nowIso();
    this.saveState();

    return this.getState();
  }

  refreshModule(moduleId) {
    const module = this.getModule(moduleId);

    if (!module) {
      throw new Error("MODULE_NOT_FOUND");
    }

    if (module.refreshable) {
      module.lastUpdatedAt = nowIso();
    }

    return this.getState();
  }

  refreshAll() {
    const updatedAt = nowIso();

    for (const module of this.modules) {
      if (module.refreshable) {
        module.lastUpdatedAt = updatedAt;
      }
    }

    return this.getState();
  }

  // Music integration
  setMusic({ title, artist, isPlaying, albumArt }) {
    if (typeof title !== "string") throw new Error("INVALID_MUSIC_TITLE");
    this.music = {
      title,
      artist: typeof artist === "string" ? artist : "",
      isPlaying: Boolean(isPlaying),
      albumArt: typeof albumArt === "string" ? albumArt : null,
      updatedAt: nowIso(),
    };
    return this.getState();
  }

  clearMusic() {
    this.music = null;
    return this.getState();
  }

  setNightMode(config) {
    if (!config || typeof config !== "object") throw new Error("INVALID_NIGHT_MODE");
    this.nightMode = {
      enabled: Boolean(config.enabled),
      auto: Boolean(config.auto),
      startHour: Number.isInteger(config.startHour) ? Math.max(0, Math.min(23, config.startHour)) : (this.nightMode?.startHour ?? 23),
      endHour: Number.isInteger(config.endHour) ? Math.max(0, Math.min(23, config.endHour)) : (this.nightMode?.endHour ?? 7),
    };
    this.saveState();
    return this.getState();
  }

  setTimer({ durationSeconds, label }) {
    const seconds = Math.floor(Number(durationSeconds));
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) {
      throw new Error("INVALID_TIMER_DURATION");
    }
    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + seconds * 1000);
    this.timer = {
      active: true,
      durationSeconds: seconds,
      startedAt: startedAt.toISOString(),
      endsAt: endsAt.toISOString(),
      label: typeof label === "string" && label.trim() ? label.trim().slice(0, 50) : "Таймер",
    };
    return this.getState();
  }

  clearTimer() {
    this.timer = null;
    return this.getState();
  }

  clearExpiredTimer(now = Date.now()) {
    if (!this.timer) return false;
    if (new Date(this.timer.endsAt).getTime() > now) return false;
    this.timer = null;
    return true;
  }

  setNote({ text, sender, durationMinutes }) {
    if (typeof text !== "string" || !text.trim()) {
      throw new Error("INVALID_NOTE_TEXT");
    }
    const createdAt = new Date();
    let expiresAt = null;
    if (durationMinutes !== undefined && durationMinutes !== null) {
      const mins = Math.floor(Number(durationMinutes));
      if (Number.isFinite(mins) && mins > 0) {
        expiresAt = new Date(createdAt.getTime() + mins * 60 * 1000).toISOString();
      }
    }
    this.note = {
      text: text.trim().slice(0, 500),
      sender: typeof sender === "string" && sender.trim() ? sender.trim().slice(0, 50) : "Заметка",
      createdAt: createdAt.toISOString(),
      expiresAt,
    };
    return this.getState();
  }

  clearNote() {
    this.note = null;
    return this.getState();
  }

  clearExpiredNote(now = Date.now()) {
    if (!this.note || !this.note.expiresAt) return false;
    if (new Date(this.note.expiresAt).getTime() > now) return false;
    this.note = null;
    return true;
  }
}

export function createFileStateStorage(filePath) {
  return {
    async load() {
      try {
        const payload = JSON.parse(await readFile(filePath, "utf8"));
        return payload?.state && typeof payload.state === "object" ? payload.state : {};
      } catch (error) {
        return {};
      }
    },
    async save(state) {
      await mkdir(dirname(filePath), { recursive: true });
      const body = JSON.stringify(
        {
          version: 1,
          state,
        },
        null,
        2,
      );
      const tempPath = `${filePath}.tmp`;
      await writeFile(tempPath, body, "utf8");
      await rename(tempPath, filePath);
    },
  };
}

export function createPostgresStateStorage(connectionString) {
  let pool = null;
  let initPromise = null;

  async function getPool() {
    if (!pool) {
      const { default: pg } = await import("pg");
      pool = new pg.Pool({ connectionString });
    }
    return pool;
  }

  async function initDb() {
    if (!initPromise) {
      const p = await getPool();
      initPromise = p.query(`
        CREATE TABLE IF NOT EXISTS mirror_state (
          id VARCHAR(50) PRIMARY KEY,
          data JSONB NOT NULL
        );
      `).catch(err => {
        initPromise = null;
        throw err;
      });
    }
    return initPromise;
  }

  return {
    async load() {
      try {
        await initDb();
        const p = await getPool();
        const res = await p.query("SELECT data FROM mirror_state WHERE id = 'default_state'");
        if (res.rows.length > 0 && res.rows[0].data) {
          return res.rows[0].data.state || {};
        }
        return {};
      } catch (error) {
        logger.error({ err: error }, "Failed to load state from Postgres");
        return {};
      }
    },
    async save(state) {
      try {
        await initDb();
        const p = await getPool();
        const body = {
          version: 1,
          state,
        };
        await p.query(
          `INSERT INTO mirror_state (id, data) VALUES ($1, $2)
           ON CONFLICT (id) DO UPDATE SET data = $2`,
          ['default_state', body]
        );
      } catch (error) {
        logger.error({ err: error }, "Failed to save state to Postgres");
      }
    },
  };
}
