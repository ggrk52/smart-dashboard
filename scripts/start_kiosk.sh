#!/bin/bash
# Single instance lock using flock
exec 200>/tmp/smart_dashboard_kiosk.lock
flock -n 200 || { echo "Kiosk is already running! Exiting."; exit 0; }

# Prevent screen from sleeping / turning off
xset -dpms 2>/dev/null || true
xset s off 2>/dev/null || true
xset s noblank 2>/dev/null || true

# Hide mouse cursor when idle
unclutter -idle 1.0 -root &

DASH_PORT="3000"
DASH_URL="http://127.0.0.1:${DASH_PORT}/"

echo "Waiting for Smart Dashboard server at ${DASH_URL}..."
while ! curl -s -f "http://127.0.0.1:${DASH_PORT}/api/health" > /dev/null 2>&1; do
  sleep 1
done
echo "Dashboard is ready! Launching Chromium Kiosk..."

CHROMIUM_PROFILE="/tmp/chromium-kiosk-profile"
mkdir -p "$CHROMIUM_PROFILE/Default"

# Disable translate and password manager
cat << 'PREF' > "$CHROMIUM_PROFILE/Default/Preferences"
{
  "translate": { "enabled": false },
  "translate_blocked_languages": ["en", "ru", "*"],
  "profile": { "password_manager_enabled": false }
}
PREF

CHROMIUM_FLAGS=(
  "--kiosk"
  "--noerrdialogs"
  "--disable-infobars"
  "--check-for-update-interval=31536000"
  "--disable-session-crashed-bubble"
  "--disable-translate"
  "--lang=ru"
  "--disable-features=Translate,TranslateUI,OptimizationHints,MediaRouter"
  "--enable-features=VaapiVideoDecoder,CanvasOopRasterization"
  "--enable-gpu-rasterization"
  "--enable-zero-copy"
  "--ignore-gpu-blocklist"
  "--enable-native-gpu-memory-buffers"
  "--disable-software-rasterizer"
  "--disable-background-timer-throttling"
  "--disable-renderer-backgrounding"
  "--autoplay-policy=no-user-gesture-required"
  "--user-data-dir=$CHROMIUM_PROFILE"
  "--disk-cache-dir=/tmp/chromium-cache"
  "--disk-cache-size=33554432"
)

BROWSER_BIN="chromium"
if ! command -v chromium > /dev/null 2>&1; then
  BROWSER_BIN="chromium-browser"
fi

# Run Chromium and keep it running only if it crashes/closes
while true; do
  "$BROWSER_BIN" "${CHROMIUM_FLAGS[@]}" "$DASH_URL"
  sleep 3
done
