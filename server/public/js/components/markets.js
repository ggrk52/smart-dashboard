let fiatRates = null;
let cryptoRates = null;

function formatRub(value, fractionDigits = 2) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }

  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(value);
}

function formatMarketDelta(value, previous) {
  if (typeof value !== "number" || typeof previous !== "number") {
    return "";
  }

  const delta = value - previous;
  if (Math.abs(delta) < 0.0001) {
    return "0.00";
  }

  return `${delta > 0 ? "+" : ""}${formatRub(delta, 2)}`;
}

function formatCryptoDelta(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "";
  }

  return `${value > 0 ? "+" : ""}${formatRub(value, 2)}%`;
}

function marketDeltaClass(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "";
  }

  if (value > 0) {
    return "up";
  }

  if (value < 0) {
    return "down";
  }

  return "";
}

export function renderMarkets(payload, onRender) {
  const marquee = document.querySelector("#marketsMarquee");
  if (!marquee) return;

  const fiatItems = (payload.fiat ?? []).map((item) => {
    const val = formatRub(item.valueRub, item.valueRub > 1000 ? 0 : 2);
    const delta = item.valueRub - item.previousRub;
    const deltaStr = formatMarketDelta(item.valueRub, item.previousRub);
    const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "";
    return `${item.code} ${val} ₽ <span class="${marketDeltaClass(delta)}">${arrow} ${deltaStr}</span>`;
  });

  const cryptoItems = (payload.crypto ?? []).map((item) => {
    const val = formatRub(item.valueRub, item.valueRub > 1000 ? 0 : 2);
    const deltaStr = formatCryptoDelta(item.change24hPct);
    const arrow = item.change24hPct > 0 ? "▲" : item.change24hPct < 0 ? "▼" : "";
    return `${item.code} $${val} <span class="${marketDeltaClass(item.change24hPct)}">${arrow} ${deltaStr}</span>`;
  });

  const allItems = [...fiatItems, ...cryptoItems].join('<span class="market-sep">✦</span>');
  
  // Duplicate for smooth scrolling
  marquee.innerHTML = `${allItems} <span class="market-sep">✦</span> ${allItems} <span class="market-sep">✦</span> ${allItems}`;
  
  onRender?.();
}

export async function loadMarkets(wsToken, onRender) {
  if (!fiatRates) fiatRates = document.querySelector("#fiatRates");
  if (!cryptoRates) cryptoRates = document.querySelector("#cryptoRates");

  try {
    const response = await fetch("/api/markets", {
      headers: {
        Authorization: `Bearer ${wsToken}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Market request failed");
    }

    renderMarkets(await response.json(), onRender);
  } catch (error) {
    console.error("Markets load failed:", error);
    const marquee = document.querySelector("#marketsMarquee");
    if (marquee) marquee.textContent = "нет данных";
    onRender?.();
  }
}

let selectedCurrency = "USD";

export async function loadMarketsChart(wsToken, currencyCode) {
  selectedCurrency = currencyCode;
  
  const buttons = document.querySelectorAll("#marketsChartButtons button");
  buttons.forEach(btn => {
    if (btn.dataset.code === currencyCode) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  const titleEl = document.querySelector("#marketsChartTitle");
  if (titleEl) {
    titleEl.textContent = `${currencyCode} / RUB (30 дней)`;
  }

  const svgEl = document.querySelector("#marketsChartSvg");
  if (!svgEl) return;

  try {
    const res = await fetch(`/api/markets/history?code=${currencyCode}`, {
      headers: {
        Authorization: `Bearer ${wsToken}`
      }
    });

    if (!res.ok) throw new Error("History fetch failed");

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      svgEl.innerHTML = `<text x="200" y="75" class="chart-text" text-anchor="middle">нет данных</text>`;
      return;
    }

    renderMarketsChartSvg(svgEl, data);
  } catch (err) {
    console.error("Failed to load history chart:", err);
    svgEl.innerHTML = `<text x="200" y="75" class="chart-text" text-anchor="middle" fill="#ffb6b6">ошибка загрузки</text>`;
  }
}

function renderMarketsChartSvg(svgEl, data) {
  const width = 400;
  const height = 150;
  
  const chartMinX = 20;
  const chartMaxX = 380;
  const chartMinY = 15;
  const chartMaxY = 120;
  
  const values = data.map(d => d.valueRub);
  let minVal = Math.min(...values);
  let maxVal = Math.max(...values);
  
  if (minVal === maxVal) {
    minVal -= 1;
    maxVal += 1;
  }
  
  const points = data.map((d, index) => {
    const x = chartMinX + (index / (data.length - 1)) * (chartMaxX - chartMinX);
    const y = chartMaxY - ((d.valueRub - minVal) / (maxVal - minVal)) * (chartMaxY - chartMinY);
    return { x, y, val: d.valueRub, date: d.date };
  });

  let svgContent = `
    <defs>
      <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(255, 255, 255, 0.22)" />
        <stop offset="100%" stop-color="rgba(255, 255, 255, 0)" />
      </linearGradient>
    </defs>
  `;

  const gridLevels = [chartMinY, (chartMinY + chartMaxY) / 2, chartMaxY];
  gridLevels.forEach(y => {
    svgContent += `<line x1="${chartMinX}" y1="${y}" x2="${chartMaxX}" y2="${y}" class="chart-grid" />`;
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  svgContent += `<path d="${linePath}" class="chart-line" />`;

  const firstP = points[0];
  const lastP = points[points.length - 1];
  const areaPath = `${linePath} L ${lastP.x.toFixed(1)} ${chartMaxY} L ${firstP.x.toFixed(1)} ${chartMaxY} Z`;
  svgContent += `<path d="${areaPath}" class="chart-area" />`;

  const formatValue = (v) => v > 1000 ? Math.round(v).toLocaleString('ru-RU') : v.toFixed(2);
  svgContent += `<text x="${chartMaxX}" y="${chartMinY - 2}" class="chart-text" text-anchor="end">${formatValue(maxVal)} ₽</text>`;
  svgContent += `<text x="${chartMaxX}" y="${chartMaxY + 12}" class="chart-text" text-anchor="end">${formatValue(minVal)} ₽</text>`;

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    const day = d.getDate().toString().padStart(2, "0");
    const month = (d.getMonth() + 1).toString().padStart(2, "0");
    return `${day}.${month}`;
  };
  svgContent += `<text x="${chartMinX}" y="${chartMaxY + 12}" class="chart-text">${formatDate(firstP.date)}</text>`;

  svgEl.innerHTML = svgContent;
}

export function initMarketsChart(wsToken) {
  const container = document.querySelector("#marketsChartButtons");
  if (!container) return;

  container.addEventListener("click", (event) => {
    const btn = event.target.closest("button");
    if (!btn) return;
    const code = btn.dataset.code;
    if (code) {
      loadMarketsChart(wsToken, code);
    }
  });

  loadMarketsChart(wsToken, "USD");
}

export function startMarketsPolling(wsToken, onRender) {
  loadMarkets(wsToken, onRender);
  initMarketsChart(wsToken);
  window.setInterval(() => loadMarkets(wsToken, onRender), 2 * 60 * 1000);
}
