let currentCityName = "Москва";
let currentLatitude = "55.7558";
let currentLongitude = "37.6173";
let currentTimezone = "Europe/Moscow";

const weatherCodeLabels = new Map([
  [0, "ясно"],
  [1, "почти ясно"],
  [2, "переменная облачность"],
  [3, "пасмурно"],
  [45, "туман"],
  [48, "изморозь"],
  [51, "морось"],
  [53, "морось"],
  [55, "сильная морось"],
  [56, "ледяная морось"],
  [57, "ледяная морось"],
  [61, "дождь"],
  [63, "дождь"],
  [65, "сильный дождь"],
  [66, "ледяной дождь"],
  [67, "ледяной дождь"],
  [71, "снег"],
  [73, "снег"],
  [75, "сильный снег"],
  [77, "снежные зерна"],
  [80, "ливень"],
  [81, "ливень"],
  [82, "сильный ливень"],
  [85, "снегопад"],
  [86, "сильный снегопад"],
  [95, "гроза"],
  [96, "гроза с градом"],
  [99, "гроза с градом"],
]);

// Map WMO weather codes to inline SVG symbol IDs
function weatherCodeIcon(code) {
  if (code === 0 || code === 1) return "#wi-sun";
  if (code === 2) return "#wi-partly";
  if (code === 3) return "#wi-cloud";
  if (code === 45 || code === 48) return "#wi-fog";
  if (code >= 51 && code <= 67) return "#wi-rain";
  if (code >= 71 && code <= 77) return "#wi-snow";
  if (code >= 80 && code <= 82) return "#wi-rain";
  if (code >= 85 && code <= 86) return "#wi-snow";
  if (code >= 95) return "#wi-storm";
  return "#wi-cloud";
}

let weatherTemp = null;
let weatherPlace = null;
let weatherIcon = null;
let forecastList = null;
let weatherAdvice = null;

function computeWeatherAdvice(weather) {
  const currentTemp = weather.current?.temperature_2m;
  const currentCode = weather.current?.weather_code ?? 0;
  const hourly = weather.hourly ?? {};

  // Check if precipitation is occurring now
  const isPrecipNow = (currentCode >= 51 && currentCode <= 67) || (currentCode >= 80 && currentCode <= 82) || currentCode >= 95;
  const isSnowNow = (currentCode >= 71 && currentCode <= 77) || (currentCode >= 85 && currentCode <= 86);

  if (isPrecipNow) {
    return "Возьми зонт ☔";
  }
  if (isSnowNow) {
    return "Идёт снег, одевайся теплее ❄️";
  }

  // Check upcoming 3 hours for rain/snow
  if (Array.isArray(hourly.weather_code) && Array.isArray(hourly.time)) {
    const now = new Date();
    const currentHourISO = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().substring(0, 13) + ":00";
    let startIndex = hourly.time.findIndex((t) => t >= currentHourISO);
    if (startIndex !== -1) {
      for (let i = 1; i <= 3; i++) {
        const nextCode = hourly.weather_code[startIndex + i];
        if ((nextCode >= 51 && nextCode <= 67) || (nextCode >= 80 && nextCode <= 82) || nextCode >= 95) {
          return "Скоро дождь, возьми зонт ☔";
        }
        if ((nextCode >= 71 && nextCode <= 77) || (nextCode >= 85 && nextCode <= 86)) {
          return "Скоро снег, одевайся теплее ❄️";
        }
      }
    }
  }

  // Temperature-based advice
  if (typeof currentTemp === "number") {
    if (currentTemp < -10) return "Сильный мороз, кутайся 🧣";
    if (currentTemp < 0) return "Морозно, надень шапку и перчатки 🧤";
    if (currentTemp < 10) return "Прохладно, тёплая куртка 🧥";
    if (currentTemp < 18) return "Свежая погода, ветровка или худи 🍂";
    if (currentTemp > 25 && (currentCode === 0 || currentCode === 1)) return "Жарко и солнечно, надень очки 🕶️";
    if (currentTemp > 20) return "Отличная тёплая погода! ☀️";
  }

  if (currentCode === 45 || currentCode === 48) {
    return "Густой туман на улице 🌫️";
  }

  return "Хорошего дня!";
}

function formatTemperature(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return Math.round(value).toString();
}

function formatForecastTemperature(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--°C";
  }
  return `${Math.round(value)}°C`;
}

function formatForecastDay(value) {
  const date = new Date(`${value}T12:00:00+03:00`);
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
  })
    .format(date)
    .replace(".", "");
}

function weatherCodeLabel(code) {
  return weatherCodeLabels.get(code) ?? "погода";
}

function renderWeather(weather, onRender) {
  if (!weatherTemp) weatherTemp = document.querySelector("#weatherTemp");
  if (!weatherPlace) weatherPlace = document.querySelector("#weatherPlace");
  if (!weatherIcon) weatherIcon = document.querySelector("#weatherIcon");
  if (!forecastList) forecastList = document.querySelector("#forecastList");
  if (!weatherAdvice) weatherAdvice = document.querySelector("#weatherAdvice");

  if (!weatherTemp || !weatherPlace || !forecastList) return;

  const currentTemperature = weather.current?.temperature_2m;
  const currentCode = weather.current?.weather_code;
  const hourly = weather.hourly ?? {};

  weatherTemp.innerHTML = `${formatTemperature(currentTemperature)}<span>&deg;C</span>`;
  weatherPlace.textContent = `${currentCityName} · ${weatherCodeLabel(currentCode)}`;

  if (weatherAdvice) {
    const advice = computeWeatherAdvice(weather);
    weatherAdvice.textContent = advice;
    weatherAdvice.hidden = !advice;
  }

  // Update weather icon SVG
  if (weatherIcon) {
    const use = weatherIcon.querySelector("use");
    if (use) {
      use.setAttribute("href", weatherCodeIcon(currentCode));
    }
  }

  forecastList.replaceChildren();

  // Find the next 5 hours
  const now = new Date();
  const currentHourISO = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().substring(0, 13) + ":00";
  
  let startIndex = hourly.time?.findIndex(t => t >= currentHourISO);
  if (startIndex === -1 || startIndex === undefined) startIndex = 0;

  for (let i = 0; i < 5; i++) {
    const index = startIndex + i + 1; // start from next hour
    if (index >= (hourly.time?.length ?? 0)) break;

    const item = document.createElement("li");
    const timeSpan = document.createElement("span");
    const tempStrong = document.createElement("strong");

    const svgNamespace = "http://www.w3.org/2000/svg";
    const iconSvg = document.createElementNS(svgNamespace, "svg");
    iconSvg.setAttribute("viewBox", "0 0 64 64");
    iconSvg.setAttribute("aria-hidden", "true");
    const iconUse = document.createElementNS(svgNamespace, "use");
    iconUse.setAttribute("href", weatherCodeIcon(hourly.weather_code?.[index]));
    iconSvg.append(iconUse);

    const date = new Date(hourly.time[index]);
    timeSpan.textContent = `${date.getHours().toString().padStart(2, '0')}:00`;
    tempStrong.textContent = formatForecastTemperature(hourly.temperature_2m[index]);
    
    item.title = weatherCodeLabel(hourly.weather_code?.[index]);
    item.append(timeSpan, iconSvg, tempStrong);
    forecastList.append(item);
  }

  onRender?.();
}

let activeOnRender = null;

export function updateWeatherConfig(config) {
  if (!config) return;
  const changed =
    currentCityName !== config.cityName ||
    currentLatitude !== config.latitude ||
    currentLongitude !== config.longitude ||
    currentTimezone !== config.timezone;

  if (changed) {
    currentCityName = config.cityName || "Москва";
    currentLatitude = config.latitude || "55.7558";
    currentLongitude = config.longitude || "37.6173";
    currentTimezone = config.timezone || "Europe/Moscow";
    
    loadWeather(activeOnRender);
  }
}

export async function loadWeather(onRender) {
  if (!weatherPlace) weatherPlace = document.querySelector("#weatherPlace");

  const url = `/api/weather?lat=${encodeURIComponent(currentLatitude)}&lon=${encodeURIComponent(currentLongitude)}`;

  try {
    const response = await fetch(url, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Weather request failed");
    }

    renderWeather(await response.json(), onRender);
  } catch (error) {
    console.error("Weather load failed:", error);
    if (weatherPlace) {
      weatherPlace.textContent = `${currentCityName} · нет данных`;
    }
    onRender?.();
  }
}

export function startWeatherPolling(onRender) {
  activeOnRender = onRender;
  loadWeather(onRender);
  window.setInterval(() => loadWeather(onRender), 10 * 60 * 1000);
}
