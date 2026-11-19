import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const DEFAULT_MODULE_LAYOUTS = Object.freeze({
  clock: Object.freeze({ x: 2, y: 2, w: 46, h: 22 }),
  calendar: Object.freeze({ x: 2, y: 25, w: 46, h: 24 }),
  dishes: Object.freeze({ x: 2, y: 50, w: 46, h: 36 }),
  weather: Object.freeze({ x: 50, y: 2, w: 48, h: 22 }),
  cluster: Object.freeze({ x: 50, y: 25, w: 48, h: 24 }),
  immich: Object.freeze({ x: 50, y: 50, w: 48, h: 36 }),
  news: Object.freeze({ x: 2, y: 88, w: 96, h: 10 }),
  markets: Object.freeze({ x: 50, y: 25, w: 48, h: 24 }),
  music: Object.freeze({ x: 2, y: 80, w: 96, h: 8 }),
});

const MIN_LAYOUT_WIDTH = 16;
const MIN_LAYOUT_HEIGHT = 5;

function roundPercent(value) {
  return Math.round(value * 100) / 100;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function defaultModuleLayout(moduleId) {
  const fallback = DEFAULT_MODULE_LAYOUTS[moduleId] ?? { x: 6, y: 6, w: 42, h: 12 };
  return { ...fallback };
}

export function validateModulePosition(moduleId, candidate, baseLayout = defaultModuleLayout(moduleId)) {
  const x = finiteNumber(candidate?.x);
  const y = finiteNumber(candidate?.y);
  const w = finiteNumber(candidate?.w ?? baseLayout?.w);
  const h = finiteNumber(candidate?.h ?? baseLayout?.h);

  if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) {
    throw new Error("INVALID_LAYOUT");
  }

  if (w < MIN_LAYOUT_WIDTH || h < MIN_LAYOUT_HEIGHT || w > 100 || h > 100) {
    throw new Error("LAYOUT_SIZE_OUT_OF_BOUNDS");
  }

  if (x < 0 || y < 0 || x + w > 100 || y + h > 100) {
    throw new Error("LAYOUT_OUT_OF_BOUNDS");
  }

  return {
    x: roundPercent(x),
    y: roundPercent(y),
    w: roundPercent(w),
    h: roundPercent(h),
  };
}

export function safeModuleLayout(moduleId, candidate) {
  const fallback = defaultModuleLayout(moduleId);

  try {
    return validateModulePosition(moduleId, candidate, fallback);
  } catch (error) {
    return fallback;
  }
}

export function layoutMapFromModules(modules) {
  return Object.fromEntries(
    modules.map((module) => [
      module.id,
      {
        x: module.layout.x,
        y: module.layout.y,
        w: module.layout.w,
        h: module.layout.h,
      },
    ]),
  );
}

export function createFileLayoutStorage(filePath) {
  return {
    async load() {
      try {
        const payload = JSON.parse(await readFile(filePath, "utf8"));
        return payload?.modules && typeof payload.modules === "object" ? payload.modules : {};
      } catch (error) {
        return {};
      }
    },
    async save(layoutById) {
      await mkdir(dirname(filePath), { recursive: true });
      const body = JSON.stringify(
        {
          version: 1,
          modules: layoutById,
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

export function createPostgresLayoutStorage(connectionString) {
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
        CREATE TABLE IF NOT EXISTS mirror_layout (
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
        const res = await p.query("SELECT data FROM mirror_layout WHERE id = 'default_layout'");
        if (res.rows.length > 0 && res.rows[0].data) {
          return res.rows[0].data.modules || {};
        }
        return {};
      } catch (error) {
        return {};
      }
    },
    async save(layoutById) {
      try {
        await initDb();
        const p = await getPool();
        const body = {
          version: 1,
          modules: layoutById,
        };
        await p.query(
          `INSERT INTO mirror_layout (id, data) VALUES ($1, $2)
           ON CONFLICT (id) DO UPDATE SET data = $2`,
          ['default_layout', body]
        );
      } catch (error) {
        // Suppress errors during save, similar to state storage
      }
    },
  };
}
