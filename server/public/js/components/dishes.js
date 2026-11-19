let dishContainer = null;

export async function loadDishes() {
  dishContainer = document.querySelector("#dishesModuleContent");
  if (!dishContainer) return;

  try {
    const res = await fetch("/api/dishes");
    if (!res.ok) throw new Error("Failed to fetch dishes state");
    const data = await res.json();
    renderDishes(data);
  } catch (err) {
    console.error("Dishes fetch error:", err);
  }
}

export function renderDishes(data) {
  if (!dishContainer) dishContainer = document.querySelector("#dishesModuleContent");
  if (!dishContainer || !data || !data.currentDutyName) return;

  const current = data.currentDutyName;
  const next = data.nextDutyName || "—";
  const queue = data.queue || [];
  const days = data.daysOnDuty || 0;

  dishContainer.innerHTML = `
    <div class="dishes-card">
      <div class="dishes-header">
        <span class="dishes-badge"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px;"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Z"/><path d="M21 15v7"/></svg>Дежурный по кухне</span>
        <span class="dishes-days">${days === 0 ? "Сменился сегодня" : `Дней на дежурстве: ${days}`}</span>
      </div>
      <div class="dishes-hero">
        <div class="dishes-avatar">${current.charAt(0)}</div>
        <div class="dishes-info">
          <p class="dishes-name">${current}</p>
          <p class="dishes-next">Следующий(ая): <strong>${next}</strong></p>
        </div>
      </div>
      <div class="dishes-queue">
        ${queue.map(person => `
          <div class="queue-item ${person === current ? 'active' : ''}">
            <span class="queue-dot"></span>
            <span class="queue-name">${person}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

export function startDishesPolling() {
  loadDishes();
  setInterval(loadDishes, 60000);
}
