import { loadImmichStats } from "./immich.js";
import { loadDishes } from "./dishes.js";
import { loadCluster } from "./cluster.js";
import { loadWeather } from "./weather.js";

let gamepadConnected = false;
let lastButtonsState = {};
let pollInterval = null;
let toastFunc = null;

export function initGamepad(showToast) {
  toastFunc = showToast;

  window.addEventListener("gamepadconnected", (e) => {
    gamepadConnected = true;
    updateGamepadUI(true, e.gamepad.id);
    if (toastFunc) toastFunc("🎮 Геймпад подключен!");
    startPolling();
  });

  window.addEventListener("gamepaddisconnected", () => {
    gamepadConnected = false;
    updateGamepadUI(false);
    if (toastFunc) toastFunc("🎮 Геймпад отключен");
  });

  startPolling();
}

function updateGamepadUI(connected, id = "") {
  const indicator = document.querySelector("#gamepadIndicator");
  if (indicator) {
    indicator.classList.toggle("connected", connected);
    if (connected) {
      indicator.title = id || "Геймпад активен";
    }
  }
}

function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(pollGamepad, 80);
}

function pollGamepad() {
  const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (let i = 0; i < gamepads.length; i++) {
    if (gamepads[i]) {
      gp = gamepads[i];
      break;
    }
  }

  if (!gp) {
    if (gamepadConnected) {
      gamepadConnected = false;
      updateGamepadUI(false);
    }
    return;
  }

  if (!gamepadConnected) {
    gamepadConnected = true;
    updateGamepadUI(true, gp.id);
  }

  const buttons = gp.buttons;
  function isPressed(index) {
    return buttons[index] && (buttons[index].pressed || buttons[index].value > 0.5);
  }

  const btnA = isPressed(0);
  const btnX = isPressed(2);

  if (btnA && !lastButtonsState.btnA) {
    loadDishes();
    loadCluster();
    loadWeather();
    loadImmichStats();
    if (toastFunc) toastFunc("🔄 Статистика обновлена!");
  }

  if (btnX && !lastButtonsState.btnX) {
    const marketsModule = document.querySelector('[data-module-id="markets"]');
    const clusterModule = document.querySelector('[data-module-id="cluster"]');
    if (marketsModule && clusterModule) {
      const isMarketsVisible = !marketsModule.classList.contains("module-hidden");
      marketsModule.classList.toggle("module-hidden", isMarketsVisible);
      clusterModule.classList.toggle("module-hidden", !isMarketsVisible);
      if (toastFunc) toastFunc(isMarketsVisible ? "📊 Кластер" : "📈 Курсы валют");
    }
  }

  lastButtonsState = { btnA, btnX };
}
