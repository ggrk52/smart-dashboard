let clusterContainer = null;

export async function loadCluster() {
  clusterContainer = document.querySelector("#clusterModuleContent");
  if (!clusterContainer) return;

  try {
    const res = await fetch("/api/cluster");
    if (!res.ok) throw new Error("Cluster fetch error");
    const data = await res.json();
    renderCluster(data);
  } catch (err) {
    console.error("Cluster fetch error:", err);
  }
}

export function renderCluster(data) {
  if (!clusterContainer) clusterContainer = document.querySelector("#clusterModuleContent");
  if (!clusterContainer || !data) return;

  const rpi = data.rpi5 || {};
  const opi = data.orangepi || {};

  clusterContainer.innerHTML = `
    <div class="cluster-card">
      <div class="cluster-grid">
        <div class="cluster-node">
          <div class="node-header">
            <span class="status-pulse ${rpi.status === 'Online' ? 'online' : 'offline'}"></span>
            <span class="node-title">Raspberry Pi 5</span>
            <span class="node-ip">${rpi.host || '192.168.1.75'}</span>
          </div>
          <div class="node-metrics">
            <div class="metric">
              <span class="metric-label">ЦПУ</span>
              <span class="metric-val ${rpi.tempC > 65 ? 'warm' : 'cool'}">${rpi.tempC ? rpi.tempC + '°C' : '37°C'}</span>
            </div>
            <div class="metric">
              <span class="metric-label">NVMe</span>
              <span class="metric-val highlight">${rpi.nvmeFreeGb ? rpi.nvmeFreeGb + ' GB' : '816 GB'}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Сервисы</span>
              <span class="metric-val">Immich · Dishes</span>
            </div>
          </div>
        </div>

        <div class="cluster-node">
          <div class="node-header">
            <span class="status-pulse ${opi.status === 'Online' ? 'online' : 'offline'}"></span>
            <span class="node-title">Orange Pi 4 Pro</span>
            <span class="node-ip">127.0.0.1 (Kiosk)</span>
          </div>
          <div class="node-metrics">
            <div class="metric">
              <span class="metric-label">ЦПУ</span>
              <span class="metric-val ${opi.tempC > 70 ? 'warm' : 'normal'}">${opi.tempC ? opi.tempC + '°C' : '58°C'}</span>
            </div>
            <div class="metric">
              <span class="metric-label">RAM</span>
              <span class="metric-val">${opi.ramUsage || '31%'}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Экран</span>
              <span class="metric-val">2256×1504</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function startClusterPolling() {
  loadCluster();
  setInterval(loadCluster, 30000);
}
