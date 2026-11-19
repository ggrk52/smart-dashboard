let immichContainer = null;

const ICON_PHOTO = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
const ICON_VIDEO = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;
const ICON_FILES = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
const ICON_DISK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`;
const ICON_USER = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

export async function loadImmichStats() {
  immichContainer = document.querySelector("#immichStatsContent");
  if (!immichContainer) return;

  try {
    const res = await fetch("/api/immich/stats");
    if (!res.ok) throw new Error("Failed to load Immich stats");
    const data = await res.json();
    renderImmichStats(data);
  } catch (err) {
    console.error("Immich stats error:", err);
  }
}

export function renderImmichStats(data) {
  if (!immichContainer) immichContainer = document.querySelector("#immichStatsContent");
  if (!immichContainer || !data) return;

  const isOnline = data.status === "Online";
  const photos = (data.photos || 0).toLocaleString("ru-RU");
  const videos = (data.videos || 0).toLocaleString("ru-RU");
  const total = (data.total || 0).toLocaleString("ru-RU");
  const usageGb = data.usageGb || "27.0";
  const diskAvailable = data.diskAvailable || "815.7 GiB";
  const diskTotal = data.diskSize || "915.3 GiB";
  const diskPct = data.diskUsagePercentage || 5.8;

  immichContainer.innerHTML = `
    <div class="immich-stats-card">
      <div class="immich-header">
        <div class="immich-title-wrap">
          <span class="status-pulse ${isOnline ? 'online' : 'offline'}"></span>
          <span class="immich-title">Медиатека Immich</span>
          <span class="immich-ver">${data.version || 'v3.4.1'}</span>
        </div>
        <span class="immich-user">${ICON_USER}${data.user || 'ggrk52'}</span>
      </div>

      <div class="immich-grid">
        <div class="stat-tile">
          <div class="stat-top">
            <span class="stat-icon">${ICON_PHOTO}</span>
            <span class="stat-label">Фото</span>
          </div>
          <div class="stat-number">${photos}</div>
          <div class="stat-sub">${data.usagePhotosGb || '5.1'} GB</div>
        </div>

        <div class="stat-tile">
          <div class="stat-top">
            <span class="stat-icon">${ICON_VIDEO}</span>
            <span class="stat-label">Видео</span>
          </div>
          <div class="stat-number">${videos}</div>
          <div class="stat-sub">${data.usageVideosGb || '22.0'} GB</div>
        </div>

        <div class="stat-tile">
          <div class="stat-top">
            <span class="stat-icon">${ICON_FILES}</span>
            <span class="stat-label">Всего файлов</span>
          </div>
          <div class="stat-number highlight">${total}</div>
          <div class="stat-sub">Общий вес: ${usageGb} GB</div>
        </div>

        <div class="stat-tile">
          <div class="stat-top">
            <span class="stat-icon">${ICON_DISK}</span>
            <span class="stat-label">NVMe Свободно</span>
          </div>
          <div class="stat-number">${diskAvailable}</div>
          <div class="stat-sub">из ${diskTotal} (${diskPct}% занято)</div>
        </div>
      </div>

      <div class="immich-storage-bar-wrap">
        <div class="storage-bar-track">
          <div class="storage-bar-fill" style="width: ${diskPct}%"></div>
        </div>
      </div>
    </div>
  `;
}

export function startImmichPolling() {
  loadImmichStats();
  setInterval(loadImmichStats, 60000);
}
