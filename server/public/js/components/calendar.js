function formatEventTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const eventDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  
  const diffTime = eventDay - today;
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  
  let dayLabel = "";
  if (diffDays === 0) {
    dayLabel = "Сегодня";
  } else if (diffDays === 1) {
    dayLabel = "Завтра";
  } else if (diffDays > 1 && diffDays < 7) {
    dayLabel = new Intl.DateTimeFormat("ru-RU", { weekday: "long" }).format(date);
    dayLabel = dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);
  } else {
    dayLabel = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(date);
  }
  
  // Format hours and minutes
  const hours = date.getHours();
  const minutes = date.getMinutes();
  
  // Check if it has a non-zero time (all-day events usually start at 00:00 UTC/Local depending on timezone)
  const isUtcMidnight = dateStr.endsWith("T00:00:00.000Z");
  const isLocalMidnight = hours === 0 && minutes === 0;
  
  if (!isUtcMidnight && !isLocalMidnight) {
    const hoursStr = hours.toString().padStart(2, '0');
    const minutesStr = minutes.toString().padStart(2, '0');
    return `${dayLabel}, ${hoursStr}:${minutesStr}`;
  }
  
  return dayLabel;
}

function renderEvents(events, onRender) {
  const eventList = document.querySelector("#eventList");
  if (!eventList) return;

  eventList.replaceChildren();

  if (events.length === 0) {
    const item = document.createElement("li");
    const nameSpan = document.createElement("span");
    nameSpan.className = "event-name";
    nameSpan.textContent = "Нет запланированных событий";
    item.append(nameSpan);
    eventList.append(item);
    onRender?.();
    return;
  }

  for (const event of events) {
    const item = document.createElement("li");
    const nameSpan = document.createElement("span");
    const timeSpan = document.createElement("span");

    nameSpan.className = "event-name";
    nameSpan.textContent = event.summary;

    timeSpan.className = "event-time";
    timeSpan.textContent = formatEventTime(event.start);

    item.append(nameSpan, timeSpan);
    eventList.append(item);
  }

  onRender?.();
}

export async function loadCalendarEvents(wsToken, onRender) {
  try {
    const response = await fetch("/api/calendar/events", {
      headers: {
        Authorization: `Bearer ${wsToken}`
      }
    });
    if (!response.ok) {
      throw new Error("Calendar events request failed");
    }
    const allEvents = await response.json();
    // Ограничиваем: только 5 ближайших событий в пределах текущей недели
    const now = new Date();
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const events = allEvents
      .filter(e => {
        const start = new Date(e.start);
        return start >= now && start <= weekEnd;
      })
      .slice(0, 5);
    renderEvents(events, onRender);
  } catch (error) {
    console.error("Calendar events load failed:", error);
    onRender?.();
  }
}

export function startCalendarPolling(wsToken, onRender) {
  loadCalendarEvents(wsToken, onRender);
  // Poll every 15 minutes
  window.setInterval(() => loadCalendarEvents(wsToken, onRender), 15 * 60 * 1000);
}
