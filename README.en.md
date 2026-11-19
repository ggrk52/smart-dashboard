<div align="center">

# 🪞 Magic Mirror LAN Control

<img src="https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js"/>
<img src="https://img.shields.io/badge/Android-Kotlin-7F52FF?style=for-the-badge&logo=kotlin&logoColor=white" alt="Kotlin"/>
<img src="https://img.shields.io/badge/Firebase-Cloud_Sync-FFCA28?style=for-the-badge&logo=firebase&logoColor=black" alt="Firebase"/>
<img src="https://img.shields.io/badge/WebSocket-Real--time-010101?style=for-the-badge&logo=websocket&logoColor=white" alt="WebSocket"/>
<img src="https://img.shields.io/badge/Orange_Pi-Optimized-E64A19?style=for-the-badge&logo=raspberrypi&logoColor=white" alt="Orange Pi"/>

<br/>

🌐 **Language / Язык:** [🇷🇺 Русский](README.md) | **🇬🇧 English**

<br/>

> **A full LAN control system for a smart mirror:** Node.js server + browser UI + Android controller app.  
> Designed to run on single-board computers (Orange Pi / Raspberry Pi), controlled over the local network, with optional Firebase cloud sync.

<br/>

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   📱 Android App  ──→  🌐 LAN  ──→  🖥️  Node Server    │
│      (Kotlin)               ↕              ↕            │
│   📺 Browser UI  ←─────── WS  ←──── MirrorStore        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

</div>

---

## 📦 What's Inside

| Component | Description |
|---|---|
| `server/` | Node.js HTTP server with REST API and WebSocket broadcast |
| Browser UI | Full-screen mirror interface, updated in real time |
| `android/` | Android controller app (Kotlin + Jetpack Compose) |
| `setup_orange_pi.sh` | Automated single-board setup script |
| `magic-mirror.service` | systemd service for auto-start |

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 🖥️ Browser Interface
- **Mirror mode** — classic Magic Mirror UI
- **Gallery mode** — screensaver with random paintings
- **HUD/AR mode** — face scanning and pulse rate simulation via BlazeFace/TensorFlow.js
- **Layout editor** — drag-and-drop widget positioning
- **Real-time updates** via WebSocket without page reload
- **Auto token injection** for loopback connections

</td>
<td width="50%">

### 📱 Android Controller
- **Auto-discovery** of mirrors on the local network (mDNS/Bonjour)
- **QR pairing** — instant connection by scanning
- **Floating Dock** — quick mode switching (Mirror, Gallery, AR)
- **AR mode control** — toggle simulation/camera mode and force target profiles
- **Circular carousel** of paintings with radial animation
- **Firebase sync** for presets and connection settings
- **Dynamic Material 3 themes** with accent color selection

</td>
</tr>
<tr>
<td width="50%">

### ⚙️ Server
- **REST API** with Bearer token authorization
- **Display control** — on/off/reload
- **Music widget** — now-playing sync from Android
- **Notifications** — temporary overlay messages
- **Exchange rates** — CBR + CoinGecko in real time
- **News feed** — TASS RSS feed

</td>
<td width="50%">

### 🔒 Security
- **Token authorization** on all protected routes
- **Pairing over loopback only** — remote pairing is blocked
- **64 KB WebSocket frame limit** against DoS
- **Restricted Polkit rules** with minimum NetworkManager privileges
- **EncryptedSharedPreferences** for token storage on Android

</td>
</tr>
</table>

---

## 🚀 Quick Start

### Requirements

**Server:**
- Node.js 20+
- Machine on the same LAN as the clients

**Android:**
- Android Studio (Hedgehog or newer)
- Android SDK
- Physical device or emulator

---

### 1. Clone and Install

```bash
git clone <repo-url>
cd magic-mirror
npm install
```

### 2. Start the Server

**Minimal launch (default values):**

```bash
npm start
```

**With custom parameters (PowerShell):**

```powershell
$env:MIRROR_HOST  = "0.0.0.0"
$env:MIRROR_PORT  = "8080"
$env:MIRROR_TOKEN = "your-secret-token"
npm start
```

**Or via `.env` file:**

```env
MIRROR_HOST=0.0.0.0
MIRROR_PORT=8080
MIRROR_TOKEN=your-secret-token
```

> ⚠️ Never commit `.env` to the repository — it is in `.gitignore`.

**Environment variables:**

| Variable | Default | Description |
|---|---|---|
| `MIRROR_HOST` | `0.0.0.0` | Bind address |
| `MIRROR_PORT` | `8080` | Server port |
| `MIRROR_TOKEN` | `magic-mirror-local-token` | Bearer authorization token |
| `MIRROR_SETUP_MODE` | — | Enable initial setup mode |

After launch, all available addresses are printed to the terminal:

```
Local server address:  http://127.0.0.1:8080/
LAN server address:    http://192.168.1.75:8080/
⚠  WARNING: Using the default MIRROR_TOKEN. Set a custom token before exposing the server.
```

### 3. Open the Browser Interface

```
http://127.0.0.1:8080/
```

The token is automatically injected only for loopback connections (`127.0.0.1` / `::1`).

### 4. Connect the Android App

1. Open `android/` in Android Studio
2. Wait for Gradle Sync
3. Click `Run`
4. In the app: enter **Host** (server LAN IP), **Port** and **Token** — or use QR / auto-discovery

---

## 🍊 Deploying on Orange Pi / Raspberry Pi

The `setup_orange_pi.sh` script fully automates setup:

```bash
bash setup_orange_pi.sh
```

**What the script does:**

- ✅ Installs Node.js, npm, `gpiod`, `network-manager`
- ✅ Configures **Polkit rules** (network management without `sudo`)
- ✅ Adds **UDEV rules** for framebuffer and GPIO access without root
- ✅ Runs `npm install`
- ✅ Creates and enables a `systemd` service pinned to a CPU core with a 256 MB memory limit

**Service management:**

```bash
# Status
sudo systemctl status magic-mirror.service

# Start / Stop / Restart
sudo systemctl start magic-mirror.service
sudo systemctl stop magic-mirror.service
sudo systemctl restart magic-mirror.service

# Live logs
journalctl -u magic-mirror.service -f
```

---

## 🧪 Tests

```bash
# Run all tests
npm test

# Syntax check + tests
npm run check
```

**Test coverage:**

| Area | What is tested |
|---|---|
| Health endpoint | Public access without authorization |
| Authorization | Rejection of missing / invalid tokens |
| WebSocket | Connect with token, reject without token |
| Validation | Invalid JSON, oversized payload |
| Music API | POST / DELETE / state broadcast |
| Batch visibility | Simultaneously updating multiple module visibilities |
| MirrorStore events | EventEmitter: emit on displayStateChanged / displayModeChanged |

---

## 📡 REST API

**Base URL:** `http://HOST:PORT`

**Authorization header** (for all protected routes):

```http
Authorization: Bearer YOUR_TOKEN
```

---

### 🌐 Public

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/health` | Server availability check |

---

### 🔗 Pairing *(loopback only)*

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/pairing` | Token, port, LAN addresses |
| `GET` | `/api/pairing/qr.svg` | QR code for pairing |
| `GET` | `/api/pairing/status` | Connected controller status |
| `POST` | `/api/pairing/complete` | Confirm controller connection |

---

### 🛠️ Initial Setup *(only with `MIRROR_SETUP_MODE`)*

| Method | Route | Body | Description |
|---|---|---|---|
| `GET` | `/api/setup/status` | — | Setup mode status |
| `POST` | `/api/setup/wifi` | `{ "ssid": "..." }` | Connect to Wi-Fi |
| `POST` | `/api/setup/token` | `{ "token": "..." }` | Set token |

---

### 🪞 Mirror Control 🔐

| Method | Route | Body | Description |
|---|---|---|---|
| `GET` | `/api/diagnostics` | — | Server diagnostics |
| `GET` | `/api/mirror/state` | — | Current state |
| `POST` | `/api/mirror/display` | `{ "action": "on\|off\|reload" }` | Display control |
| `POST` | `/api/mirror/mode` | `{ "mode": "mirror\|gallery\|ar" }` | Display mode (mirror / gallery / ar) |
| `POST` | `/api/mirror/ar/config` | `{ "demoMode": true\|false, "forcedProfile": "..." }` | Configure HUD/AR |
| `POST` | `/api/mirror/layout/edit` | `{ "active": true\|false }` | Layout editor toggle |
| `POST` | `/api/mirror/photo` | `{ "durationSeconds": 300 }` + base64 | Temporary photo |
| `DELETE` | `/api/mirror/photo` | — | Remove photo |
| `GET` | `/api/mirror/photo/current?id=...` | — | Get photo binary |
| `POST` | `/api/mirror/notification` | `{ "text": "...", "durationSeconds": 15 }` | Show notification |
| `DELETE` | `/api/mirror/notification` | — | Hide notification |

---

### 🎵 Music 🔐

| Method | Route | Body | Description |
|---|---|---|---|
| `POST` | `/api/music` | `{ "title": "...", "artist": "...", "isPlaying": true }` | Now playing |
| `DELETE` | `/api/music` | — | Clear music data |

---

### 📊 Data & Modules 🔐

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/markets` | Exchange rates (CBR) and crypto (CoinGecko) |
| `GET` | `/api/news/tass` | TASS news (RSS) |
| `GET` | `/api/modules` | Module list and state |
| `POST` | `/api/modules/layout` | Update widget layout |
| `POST` | `/api/modules/layout/reset` | Reset layout to defaults |
| `POST` | `/api/modules/batch-visibility` | Show/hide multiple modules in one request (`{ modules: [{ id, visible }] }`) |
| `POST` | `/api/modules/:id/visibility` | Show / hide a single module |
| `POST` | `/api/modules/:id/refresh` | Refresh a module |
| `POST` | `/api/modules/refresh-all` | Refresh all modules |

---

### 💡 Example Requests

<details>
<summary><b>Health check</b></summary>

```bash
curl http://127.0.0.1:8080/api/health
```

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/health" -Method GET
```

</details>

<details>
<summary><b>Get mirror state</b></summary>

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:8080/api/mirror/state
```

</details>

<details>
<summary><b>Turn display on / off</b></summary>

```bash
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
     -d '{"action":"off"}' http://127.0.0.1:8080/api/mirror/display
```

</details>

<details>
<summary><b>Switch mode (gallery / mirror / ar)</b></summary>

```bash
# Enable gallery screensaver
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
     -d '{"mode":"gallery"}' http://127.0.0.1:8080/api/mirror/mode

# Enable HUD/AR scanning
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
     -d '{"mode":"ar"}' http://127.0.0.1:8080/api/mirror/mode

# Return to mirror
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
     -d '{"mode":"mirror"}' http://127.0.0.1:8080/api/mirror/mode
```

</details>

<details>
<summary><b>Configure HUD/AR settings</b></summary>

```bash
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
     -d '{"demoMode":false,"forcedProfile":"Создатель"}' \
     http://127.0.0.1:8080/api/mirror/ar/config
```

Parameters:
- `demoMode` (boolean): `true` to simulate target face movement, `false` to capture real webcam frames.
- `forcedProfile` (string | null): force display of a specific profile name, or `null` for automatic detection.

</details>

<details>
<summary><b>Send a notification</b></summary>

```bash
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
     -d '{"text":"Hello, mirror!","durationSeconds":10}' \
     http://127.0.0.1:8080/api/mirror/notification
```

</details>

<details>
<summary><b>Batch update module visibility</b></summary>

```bash
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
     -d '{"modules":[{"id":"weather","visible":false},{"id":"news","visible":true}]}' \
     http://127.0.0.1:8080/api/modules/batch-visibility
```

</details>

---

## 🔌 WebSocket

The server broadcasts the full mirror state via WebSocket at every change.

**Connect:**

```javascript
const ws = new WebSocket("ws://127.0.0.1:8080/ws?token=YOUR_TOKEN");
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.type === "mirror_state_changed") {
    console.log(message.payload);
  }
};
```

**Message types:**

| Type | Description |
|---|---|
| `mirror_state_changed` | Full mirror state update |
| `pairing_status_changed` | Controller connection status update |
| `pong` | Response to a client `ping` |

> **Limit:** incoming frames are capped at **64 KB** to protect against DoS.

---

## 🏗️ Architecture

```
magic-mirror/
├── server/
│   └── src/
│       ├── index.js        # Entry point, startup
│       ├── server.js       # MirrorStore + HardwareManager init
│       ├── http.js         # HTTP router + WebSocket hub
│       ├── state.js        # Mirror state (modules, photo, music…) — extends EventEmitter
│       ├── hardware.js     # Display control (backlight sysfs / fb0 / xset)
│       ├── pairing.js      # Pairing logic (loopback-only)
│       ├── setup.js        # Initial setup mode
│       ├── discovery.js    # mDNS/Bonjour announcement
│       ├── layout.js       # Widget layout management
│       ├── markets.js      # Exchange rates and crypto
│       └── news.js         # RSS news feed
├── android/                # Kotlin/Compose Android app
│   └── app/src/main/
│       ├── MagicMirrorApp.kt      # Main screen + navigation
│       ├── data/MagicMirrorApi.kt # WebSocket client + REST
│       └── ui/theme/Theme.kt      # Material 3 + dynamic themes
├── setup_orange_pi.sh      # SBC auto-setup script
├── magic-mirror.service    # systemd service
└── .env                    # Configuration (not in git)
```

---

## 🔒 Security

| Threat | Protection |
|---|---|
| Unauthorized API access | Bearer token on all protected routes |
| Remote pairing | Pairing endpoint accessible **from loopback only** (`127.0.0.1`/`::1`) |
| DoS via large frames | WS payload capped at **64 KB** |
| Privilege escalation (Linux) | Polkit rules with minimum required NetworkManager actions |
| Token storage on Android | `EncryptedSharedPreferences` (AES-256-GCM) |

**Recommendations:**
- Change `MIRROR_TOKEN` from its default value before first run (server warns you at startup)
- Use only on a trusted local network — TLS is not supported
- On Linux: ensure the port is closed from WAN (`ufw deny 8080/tcp` on the WAN interface)

---

## 🛠️ Troubleshooting

<details>
<summary><b>Browser UI doesn't connect</b></summary>

- Make sure the Node server is running
- Use the host and port the server printed at startup
- If you changed `MIRROR_TOKEN` — restart the server and reload the page

</details>

<details>
<summary><b>Another LAN device can't reach the UI</b></summary>

- Make sure `MIRROR_HOST=0.0.0.0`
- Check Windows Firewall / `ufw`
- Both devices must be on the same Wi-Fi network
- Use the LAN IP (`192.168.x.x`), not `127.0.0.1`

</details>

<details>
<summary><b>Android app can't connect</b></summary>

- Double-check host, port and token — no typos
- Phone and server must be on the same Wi-Fi network
- The `Host` field accepts `192.168.1.75`, `192.168.1.75:8080` or `http://192.168.1.75:8080/` — the app normalizes the address
- On Linux: open the port: `sudo ufw allow 8080/tcp`

</details>

<details>
<summary><b>API returns 401</b></summary>

Bearer token is missing or incorrect. Use the same token the server was started with (`MIRROR_TOKEN`).

</details>

<details>
<summary><b>API returns 413</b></summary>

JSON body is too large. Keep the payload under **64 KB**.

</details>

<details>
<summary><b>Service won't start on Orange Pi</b></summary>

```bash
# View detailed error
journalctl -u magic-mirror.service --no-pager -n 50

# Check that .env exists and contains MIRROR_TOKEN
cat ~/magic-mirror-orange-pi/.env
```

</details>

---

## 📄 License

**Proprietary / All Rights Reserved**.  
Unauthorized copying, reproduction, distribution, modification, or creation of derivative works of this project, via any medium, is strictly prohibited without prior written permission of the copyright holder (**ggrk52**).

---

<div align="center">

Made with ❤️ for a smart home that actually looks good.

📋 [ROADMAP — future ideas & plans](ROADMAP.md)

</div>
