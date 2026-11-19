let dateLine = null;
let timeHours = null;
let timeMinutes = null;
let timeMain = null;
let timeSeconds = null;
let timePeriod = null;
let greetingLine = null;

let _lastDateStr = "";
let _lastHours = "";
let _lastMinutes = "";
let _lastSeconds = "";
let _lastGreeting = "";

function formatMirrorDate(now) {
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);
}

function getGreeting(hour) {
  if (hour >= 4 && hour < 12) return "Доброе утро";
  if (hour >= 12 && hour < 17) return "Добрый день";
  if (hour >= 17 && hour < 23) return "Добрый вечер";
  return "Спокойной ночи";
}

export function updateClock() {
  if (!dateLine) dateLine = document.querySelector("#dateLine");
  if (!timeHours) timeHours = document.querySelector("#timeHours");
  if (!timeMinutes) timeMinutes = document.querySelector("#timeMinutes");
  if (!timeMain) timeMain = document.querySelector("#timeMain");
  if (!timeSeconds) timeSeconds = document.querySelector("#timeSeconds");
  if (!timePeriod) timePeriod = document.querySelector("#timePeriod");
  if (!greetingLine) greetingLine = document.querySelector("#greetingLine");

  const now = new Date();
  const hourNum = now.getHours();
  const hours = String(hourNum).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  if (timeHours && timeMinutes) {
    if (_lastHours !== hours) {
      timeHours.textContent = hours;
      _lastHours = hours;
    }
    if (_lastMinutes !== minutes) {
      timeMinutes.textContent = minutes;
      _lastMinutes = minutes;
    }
  } else if (timeMain) {
    const timeStr = `${hours}:${minutes}`;
    if (_lastHours !== timeStr) {
      timeMain.textContent = timeStr;
      _lastHours = timeStr;
    }
  }

  if (timeSeconds && _lastSeconds !== seconds) {
    timeSeconds.textContent = seconds;
    _lastSeconds = seconds;
  }

  const dateStr = formatMirrorDate(now);
  if (dateLine && _lastDateStr !== dateStr) {
    dateLine.textContent = dateStr;
    _lastDateStr = dateStr;
  }

  if (greetingLine) {
    const greeting = getGreeting(hourNum);
    if (_lastGreeting !== greeting) {
      greetingLine.textContent = greeting;
      _lastGreeting = greeting;
    }
  }
}

export function startClock() {
  updateClock();
  window.setInterval(updateClock, 1000);
}
